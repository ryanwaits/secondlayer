#!/usr/bin/env bash
# Runs ON the scratch VM as root, driven by run.sh (never run it on the live
# workload host). Brings up tenant stacks A (probe), B (benign fixture, runsc)
# and C (same fixture, runc, comparison only), runs the containment suite and
# the resource checks, and writes everything to $OUT.
#
# Secrets: the hosted read key is read from /root/hosted.env (mode 600) and
# only ever reaches the mode-600 env files of stacks B and C, plus curl via a
# stdin config. Stack A gets a dummy key. No `set -x` anywhere.
set -uo pipefail

: "${WORKLOAD_IMAGE_TAG:?}"
ROOT=/opt/spike
SPIKE_DIR=$ROOT/spike/045-containment
OUT=$ROOT/out
ENVD=/root/spike-env
IMG="ghcr.io/ryanwaits/secondlayer-api:${WORKLOAD_IMAGE_TAG}"
FIXTURE=spike-pox5-fixture
export WORKLOAD_IMAGE_TAG SPIKE_DIR
mkdir -p "$OUT" "$ENVD"
chmod 700 "$ENVD"

log() { printf '[%s] %s\n' "$(date -u +%T)" "$*"; }
note() { printf '%s\n' "$*" >>"$OUT/notes.txt"; }
jl() { jq -nc "$@"; }

dc() { # dc <a|b|c> <compose args...>
	local s=$1
	shift
	local f=(-f "$ROOT/docker/workload/tenant.compose.yml" -f "$SPIKE_DIR/tenant.hardening.yml")
	[ "$s" = c ] && f+=(-f "$SPIKE_DIR/tenant.runc.yml")
	[ "$s" != a ] && f+=(-f "$SPIKE_DIR/tenant.bench.yml")
	docker compose -p "tenant-$s" "${f[@]}" --env-file "$ENVD/$s.env" "$@"
}

cursor() { docker exec "tenant-$1-postgres-1" psql -U secondlayer -Atc \
	"select coalesce(max(last_processed_block),0) from subgraphs where name='$FIXTURE'" 2>/dev/null; }

b_state() {
	local api running
	api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3922/health)
	running=$(docker inspect -f '{{.State.Running}}' tenant-b-subgraph-processor-1 2>/dev/null)
	jl --arg c "$(cursor b)" --arg api "$api" --arg r "$running" \
		'{b_cursor:($c|tonumber? // 0), b_api_http:$api, b_processor_running:$r}'
}

mem_snapshot() { # mem_snapshot <label>
	{
		echo "## $1 $(date -u +%FT%TZ)"
		docker stats --no-stream --format '{{.Name}}|{{.MemUsage}}|{{.CPUPerc}}|{{.PIDs}}'
		free -m
	} >>"$OUT/memory.txt" 2>&1
}

# ---------------------------------------------------------------- preflight
log "preflight"
{
	uname -a
	lscpu | grep -E 'Model name|^CPU\(s\)'
	free -m
	docker version --format 'docker {{.Server.Version}}'
	docker compose version
	echo "--- runsc"
	ls -l /usr/local/bin/runsc /usr/bin/runsc 2>&1
	runsc --version 2>&1 | head -3
	echo "--- daemon.json"
	cat /etc/docker/daemon.json
	echo "--- docker runtimes"
	docker info --format '{{json .Runtimes}}'
	echo "--- /dev/kvm"
	ls -l /dev/kvm 2>&1
	echo "--- cloud-init"
	cloud-init status --long 2>&1
} >"$OUT/host-info.txt" 2>&1

apt-get install -y -qq jq >/dev/null 2>&1 || {
	log "jq install failed"
	exit 2
}

if [ ! -x /usr/local/bin/runsc ]; then
	note "FINDING: cloud-init.yaml registers runsc at /usr/local/bin/runsc but that path does not exist on the booted host."
	if [ -x /usr/bin/runsc ]; then
		note "FINDING: the gVisor apt package installed /usr/bin/runsc; this run symlinked it to /usr/local/bin/runsc on the scratch VM only so the suite could proceed."
		ln -s /usr/bin/runsc /usr/local/bin/runsc
	else
		note "STOP: runsc is not installed at all."
		exit 3
	fi
fi

log "pull images"
docker pull -q "$IMG" >/dev/null || {
	note "STOP: cannot pull $IMG"
	exit 2
}
docker pull -q "$(grep -o 'postgres:17-alpine@sha256:[0-9a-f]*' "$ROOT/docker/workload/tenant.compose.yml" | head -1)" >/dev/null

# ------------------------------------------- Bun under runsc (platform probe)
log "bun-under-runsc smoke"
SMOKE='const t=Buffer.alloc(256*1024*1024,1); let a=0; for (let i=0;i<5e6;i++) a+=i%7; const p=Bun.spawnSync(["true"]); console.log(JSON.stringify({bun:Bun.version, mmapMB:t.length>>20, loop:a, spawnExit:p.exitCode, arch:process.arch}))'
PLATFORM="systrap (runsc default, no --platform flag)"
if docker run --rm --runtime runsc "$IMG" bun -e "$SMOKE" >"$OUT/runsc-smoke.txt" 2>&1; then
	log "smoke ok (default platform)"
else
	log "smoke failed on default platform"
	{
		echo "--- default platform FAILED"
	} >>"$OUT/runsc-smoke.txt"
	if [ -e /dev/kvm ]; then
		jq '.runtimes.runsc.runtimeArgs=["--platform=kvm"]' /etc/docker/daemon.json >/tmp/daemon.json && mv /tmp/daemon.json /etc/docker/daemon.json
		systemctl restart docker
		sleep 5
		if docker run --rm --runtime runsc "$IMG" bun -e "$SMOKE" >>"$OUT/runsc-smoke.txt" 2>&1; then
			PLATFORM="kvm (default platform failed)"
		else
			note "STOP: Bun cannot run under runsc on the default platform or --platform=kvm."
			exit 3
		fi
	else
		note "STOP: Bun failed under runsc default platform and /dev/kvm is absent, so kvm cannot be tried."
		exit 3
	fi
fi
echo "$PLATFORM" >"$OUT/platform.txt"
cat "$OUT/runsc-smoke.txt" >>"$OUT/host-info.txt"

# ------------------------------------------------ 1a: startup experiments
log "1a experiments (user 1000 / read-only)"
X="$OUT/1a-experiments.txt"
{
	echo "## E1 named volume under user 1000 (image has no /data/subgraphs, volume is created root-owned)"
	docker volume create spike-e1 >/dev/null
	echo "before chown:"
	docker run --rm --runtime runsc --user 1000:1000 --read-only --tmpfs /tmp -v spike-e1:/data/subgraphs "$IMG" sh -c 'touch /data/subgraphs/x && echo write-ok || echo write-failed' 2>&1
	docker run --rm --user 0:0 -v spike-e1:/data/subgraphs "$IMG" sh -c 'mkdir -p /data/subgraphs && chown -R 1000:1000 /data'
	echo "after chown 1000:1000 (volume-init):"
	docker run --rm --runtime runsc --user 1000:1000 --read-only --tmpfs /tmp -v spike-e1:/data/subgraphs "$IMG" sh -c 'touch /data/subgraphs/x && echo write-ok || echo write-failed' 2>&1
	docker volume rm spike-e1 >/dev/null
	echo
	echo "## E2 socket dir: root-owned 0700 (what the provisioner creates) mounted into a uid 1000 container"
	mkdir -p /opt/spike-e2 && chmod 700 /opt/spike-e2
	docker run --rm --runtime runsc --user 1000:1000 -v /opt/spike-e2:/var/run/secondlayer "$IMG" sh -c 'ls /var/run/secondlayer >/dev/null && echo list-ok || echo list-failed' 2>&1
	chown 1000:1000 /opt/spike-e2
	echo "after chown 1000:1000:"
	docker run --rm --runtime runsc --user 1000:1000 -v /opt/spike-e2:/var/run/secondlayer "$IMG" sh -c 'ls /var/run/secondlayer >/dev/null && echo list-ok || echo list-failed' 2>&1
	rmdir /opt/spike-e2
	echo
	echo "## E3 read-only root without a /tmp tmpfs"
	docker run --rm --runtime runsc --user 1000:1000 --read-only "$IMG" bun -e 'require("node:fs").writeFileSync("/tmp/x","y"); console.log("tmp-write-ok")' 2>&1 | head -3
	echo "with --tmpfs /tmp:"
	docker run --rm --runtime runsc --user 1000:1000 --read-only --tmpfs /tmp "$IMG" bun -e 'require("node:fs").writeFileSync("/tmp/x","y"); console.log("tmp-write-ok")' 2>&1 | head -3
} >"$X" 2>&1

# ----------------------------------------------------------- env + hosted tip
HOSTED_KEY=$(sed -n 's/^TENANT_HOSTED_READ_KEY=//p' /root/hosted.env)
mk_env() { # mk_env <stack> <port> <key>  (socket dir root-only 0700, as the provisioner makes it)
	local sd=/opt/secondlayer-workload/tenants/spike-$1/sock
	mkdir -p "$sd"
	chmod 700 "$sd"
	READ_KEY="$3" "$SPIKE_DIR/gen-env.sh" "$ENVD/$1.env" "$2" "$sd"
}
mk_env a 3921 "dummy-read-key-for-spike"
mk_env b 3922 "$HOSTED_KEY"
mk_env c 3923 "$HOSTED_KEY"

TIP=$(printf 'header = "Authorization: Bearer %s"\n' "$HOSTED_KEY" | curl -sS -K - --max-time 15 https://api.secondlayer.tools/v1/streams/tip | jq -r .block_height)
case "$TIP" in '' | null | *[!0-9]*)
	note "STOP: could not read hosted tip"
	exit 2
	;;
esac
START=$((TIP - 400))
sed "s/__START_BLOCK__/$START/" "$SPIKE_DIR/fixture-pox5.ts" >/tmp/fixture.ts
echo "tip=$TIP startBlock=$START" >"$OUT/fixture-range.txt"

up_stack() {
	local s=$1 rc
	dc "$s" up -d --wait --wait-timeout 300 >"$OUT/up-$s.log" 2>&1
	rc=$?
	docker ps -a --filter "name=tenant-$s-" --format '{{.Names}} {{.Status}}' >"$OUT/ps-$s.txt"
	log "stack $s up rc=$rc"
	if [ $rc -ne 0 ]; then
		for c in $(docker ps -a --filter "name=tenant-$s-" --format '{{.Names}}'); do
			echo "### $c" >>"$OUT/up-$s.fail.log"
			docker logs --tail 40 "$c" >>"$OUT/up-$s.fail.log" 2>&1
		done
	fi
	return $rc
}

wait_caught_up() { # wait_caught_up <stack> <target>
	local s=$1 target=$2 deadline=$((SECONDS + 900)) c
	while [ $SECONDS -lt $deadline ]; do
		c=$(cursor "$s")
		[ "${c:-0}" -ge "$target" ] && return 0
		sleep 5
	done
	return 1
}

# --------------------------------------------- stack B: runsc, fixture + bench
log "stack B (runsc, fixture)"
up_stack b || note "stack B did not come up cleanly (see up-b.log)"
sleep 5
"$SPIKE_DIR/deploy.sh" 3922 "$ENVD/b.env" /tmp/fixture.ts >"$OUT/deploy-b.txt" 2>&1 || note "fixture deploy to B failed: $(cat "$OUT/deploy-b.txt" | head -c 400)"
wait_caught_up b "$TIP" || note "stack B did not catch up to tip $TIP within 15 min"
log "B caught up, cursor=$(cursor b)"
sleep 20
docker logs tenant-b-subgraph-processor-1 2>&1 | grep '^{"bench"' >"$OUT/bench-b-runsc.jsonl"
# webhook-service with the root-0700 socket dir: did it survive startup?
docker ps -a --filter name=tenant-b-webhook-service --format '{{.Names}} {{.Status}}' >"$OUT/webhook-service-b-status.txt"
docker logs --tail 20 tenant-b-webhook-service-1 >"$OUT/webhook-service-b.log" 2>&1

# --------------------------------------------- stack C: runc, same fixture
log "stack C (runc, fixture)"
up_stack c || note "stack C did not come up cleanly (see up-c.log)"
sleep 5
"$SPIKE_DIR/deploy.sh" 3923 "$ENVD/c.env" /tmp/fixture.ts >"$OUT/deploy-c.txt" 2>&1 || note "fixture deploy to C failed: $(head -c 400 "$OUT/deploy-c.txt")"
wait_caught_up c "$TIP" || note "stack C did not catch up to tip $TIP within 15 min"
log "C caught up, cursor=$(cursor c)"
sleep 45
docker logs tenant-c-subgraph-processor-1 2>&1 | grep '^{"bench"' >"$OUT/bench-c-runc.jsonl"
mem_snapshot "idle: B(runsc) + C(runc) both caught up at tip"
python3 "$SPIKE_DIR/stats.py" runsc "$OUT/bench-b-runsc.jsonl" >"$OUT/latency.jsonl"
python3 "$SPIKE_DIR/stats.py" runc "$OUT/bench-c-runc.jsonl" >>"$OUT/latency.jsonl"
cat "$OUT/latency.jsonl"
dc c down -v >/dev/null 2>&1

# ------------------------------------------------------ stack A: the suite
log "stack A (runsc, probe)"
dc a up -d postgres >/dev/null 2>&1
GW=$(docker network inspect tenant-a_default -f '{{(index .IPAM.Config 0).Gateway}}')
BPG=$(docker inspect -f '{{(index .NetworkSettings.Networks "tenant-b_default").IPAddress}}' tenant-b-postgres-1)
export PROBE_GATEWAY_IP=$GW PROBE_B_PG_IP=$BPG PROBE_B_API_PORT=3922
{
	echo "stack A bridge gateway (host side): $GW"
	echo "stack B postgres container ip: $BPG"
	echo "stack B TENANT_API_PORT: 3922 (published 127.0.0.1 only)"
	docker network inspect tenant-a_default -f 'A subnet: {{(index .IPAM.Config 0).Subnet}}'
	docker network inspect tenant-b_default -f 'B subnet: {{(index .IPAM.Config 0).Subnet}}'
} >"$OUT/suite-targets.txt"
nohup python3 "$SPIKE_DIR/listen.py" "$GW" 8080 5432 3922 >"$OUT/listen.log" 2>&1 &
sleep 1
HOSTSIDE=$(python3 - "$GW" <<'PY'
import socket, sys
r = []
for p in (8080, 5432, 3922):
    s = socket.socket(); s.settimeout(1)
    try:
        s.connect((sys.argv[1], p)); r.append(f"{p}:listening")
    except Exception as e:
        r.append(f"{p}:{type(e).__name__}")
    s.close()
print(" ".join(r))
PY
)
echo "host-side listener check (from the host itself): $HOSTSIDE" >>"$OUT/suite-targets.txt"
up_stack a || note "stack A did not come up cleanly (see up-a.log)"
sleep 5
"$SPIKE_DIR/deploy.sh" 3921 "$ENVD/a.env" "$SPIKE_DIR/probe.ts" >"$OUT/deploy-a.txt" 2>&1 || note "probe deploy to A failed: $(head -c 400 "$OUT/deploy-a.txt")"
for _ in $(seq 1 30); do
	n=$(docker logs tenant-a-subgraph-processor-1 2>&1 | grep -c '^{"check"')
	[ "$n" -ge 15 ] && break
	sleep 3
done
docker logs tenant-a-api-1 2>&1 | grep '^{"check"' >"$OUT/suite-deploy-probe.jsonl"
docker logs tenant-a-subgraph-processor-1 2>&1 | grep '^{"check"' >"$OUT/suite-processor.jsonl"
log "suite lines: api=$(wc -l <"$OUT/suite-deploy-probe.jsonl") processor=$(wc -l <"$OUT/suite-processor.jsonl")"
ps_a() { docker ps -a --filter name=tenant-a- --format '{{.Names}} {{.Status}}'; }
ps_a >"$OUT/ps-a-after-suite.txt"

# Positive control: the "blocked" results must come from the firewall, not from
# nothing listening. Same connect from a throwaway runsc container on A's
# network, with and without an ACCEPT rule punched ahead of WORKLOAD-INPUT.
CTL="const s=require('node:net').connect(8080,'$GW');const t=setTimeout(()=>{console.log('blocked');process.exit(0)},1000);s.on('connect',()=>{console.log('reachable');process.exit(0)});s.on('error',e=>{console.log(e.code);process.exit(0)})"
{
	echo "gateway $GW:8080 from a runsc container on tenant-a network, firewall as provisioned:"
	docker run --rm --runtime runsc --network tenant-a_default --user 1000:1000 --read-only "$IMG" bun -e "$CTL" 2>&1
	iptables -I WORKLOAD-INPUT 1 -p tcp --dport 8080 -j ACCEPT
	echo "same connect with an ACCEPT rule for :8080 inserted at the top of WORKLOAD-INPUT:"
	docker run --rm --runtime runsc --network tenant-a_default --user 1000:1000 --read-only "$IMG" bun -e "$CTL" 2>&1
	iptables -D WORKLOAD-INPUT -p tcp --dport 8080 -j ACCEPT
	echo "rule removed."
} >"$OUT/control-firewall.txt" 2>&1
{
	echo "## iptables DOCKER-USER (packet counters after the suite)"
	iptables -L DOCKER-USER -v -n -x
	echo "## iptables WORKLOAD-INPUT"
	iptables -L WORKLOAD-INPUT -v -n -x
} >"$OUT/iptables-counters.txt" 2>&1

mem_snapshot "idle: A(runsc, probe) + B(runsc, fixture)"

# ------------------------------------------------------ resource checks
res_json() { # res_json <check> <expected> <outcome> <detail>
	jl --arg c "$1" --arg e "$2" --arg o "$3" --arg d "$4" --argjson b "$(b_state)" \
		'{check:$c,expected:$e,outcome:$o,detail:$d,path:"processor",at:"module",stackB:$b}' >>"$OUT/suite-res.jsonl"
}
recreate_a() { # recreate_a <PROBE_RES value>
	PROBE_RES="$1" dc a up -d --force-recreate api subgraph-processor >/dev/null 2>&1
}

log "res:pids"
B0=$(b_state)
recreate_a pids
for _ in $(seq 1 40); do
	docker logs tenant-a-subgraph-processor-1 2>&1 | grep -q '"check":"res:pids"' && break
	sleep 3
done
PL=$(docker logs tenant-a-subgraph-processor-1 2>&1 | grep '"check":"res:pids"' | tail -1)
echo "$PL" >>"$OUT/suite-res-raw.jsonl"
sleep 5
N=$(echo "$PL" | jq -r '.outcome // empty' | sed -n 's/^stopped-at-//p')
if [ -n "$N" ] && [ "$N" -ge 64 ] && [ "$N" -le 128 ]; then V="stopped-near-128:$N"; else V="${N:+stopped-at-$N}"; V="${V:-no-result}"; fi
res_json res:pids "stops-near-128 (64..128 children)" "$V" "children=${N:-none} B_before=$B0 detail=$(echo "$PL" | jq -r '.detail // ""')"
recreate_a ""
sleep 10

log "res:memory"
T0=$(date +%s)
B0=$(b_state)
recreate_a memory
OOM=false
for _ in $(seq 1 90); do
	st=$(docker inspect -f '{{.State.OOMKilled}} {{.RestartCount}} {{.State.Status}}' tenant-a-subgraph-processor-1 2>/dev/null)
	# OOMKilled=true, or the container already restarted (RestartCount >= 1).
	if [[ "$st" == true* || "$st" =~ \ [1-9][0-9]*\  || "$st" == *restarting* ]]; then OOM=seen; fi
	[ "$OOM" = seen ] && break
	sleep 2
done
EV=$(timeout 10 docker events --since "$T0" --until "$(date +%s)" --filter event=oom --filter "container=tenant-a-subgraph-processor-1" 2>/dev/null | wc -l)
MAXMB=$(docker logs tenant-a-subgraph-processor-1 2>&1 | grep '"check":"res:memory"' | jq -r '.detail' 2>/dev/null | sed -n 's/^held=\([0-9]*\)MB/\1/p' | sort -n | tail -1)
EXIT=$(docker inspect -f '{{.State.ExitCode}}' tenant-a-subgraph-processor-1 2>/dev/null)
docker logs tenant-a-subgraph-processor-1 2>&1 | grep '"check":"res:memory"' | tail -3 >>"$OUT/suite-res-raw.jsonl"
if [ "$EV" -gt 0 ] && [ "${MAXMB:-0}" -ge 256 ] && [ "${MAXMB:-0}" -le 576 ]; then V="oom-killed-near-512MB:${MAXMB}MB"; else V="oom_events=${EV},max_held=${MAXMB:-none}MB"; fi
res_json res:memory "oom-killed-near-512MB (256..576 MB held)" "$V" "oom_events=$EV last_exit=$EXIT max_held_MB=${MAXMB:-none} state=$st B_before=$B0"
recreate_a ""
sleep 10

log "res:cpu"
B0=$(b_state)
recreate_a cpu
for _ in $(seq 1 20); do
	docker logs tenant-a-subgraph-processor-1 2>&1 | grep -q '"outcome":"start"' && break
	sleep 1
done
sleep 20
docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' >"$OUT/cpu-stats-20s.txt"
B20=$(b_state)
sleep 25
docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' >"$OUT/cpu-stats-45s.txt"
B45=$(b_state)
sleep 20
B65=$(b_state)
docker logs tenant-a-subgraph-processor-1 2>&1 | grep '"check":"res:cpu"' >>"$OUT/suite-res-raw.jsonl"
C0=$(echo "$B0" | jq -r .b_cursor)
C65=$(echo "$B65" | jq -r .b_cursor)
if [ "$C65" -gt "$C0" ]; then V="other-tenant-advanced:$((C65 - C0))-blocks"; else V="other-tenant-stalled"; fi
res_json res:cpu "other-tenant-keeps-advancing" "$V" "B cursor $C0 -> $C65 over ~65s; samples: t20=$B20 t45=$B45; A cpu limit 1"
recreate_a ""
sleep 10

# -------------------------------------------------------------- wrap up
mem_snapshot "final"
ps_a >"$OUT/ps-a-final.txt"
docker ps -a --format '{{.Names}} {{.Status}}' >"$OUT/ps-all-final.txt"
docker run --rm "$IMG" bun --version >"$OUT/bun-version.txt" 2>&1
log "remote done"
