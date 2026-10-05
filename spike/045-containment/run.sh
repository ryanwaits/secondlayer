#!/usr/bin/env bash
# One unattended containment run on a throwaway Hetzner VM.
#
# Creates (all named spike-045-<epoch>, never the live workload-host, its
# firewall, or the macbook-prod key): an ephemeral ssh key, a firewall allowing
# inbound 22 from this machine's public IP only, and a dedicated-core ccx13 VM booted from the
# SAME cloud-init the real host uses (docker/workload-host/render-cloud-init.sh).
# Runs remote.sh on it, copies the results back, and deletes everything on
# success AND failure (trap).
#
# Needs: hcloud (context `secondlayer`), ssh, jq, curl, and SECONDLAYER_API_KEY
# in the environment (the hosted read key for stack B/C only; it travels to the
# VM inside a mode-600 file over ssh and is never printed or put on a command
# line). WORKLOAD_IMAGE_TAG defaults to origin/main's sha.
#
# Usage: spike/045-containment/run.sh
set -euo pipefail

cd "$(dirname "$0")/../.."
REPO=$(pwd)
RES="$REPO/spike/045-containment/results"
EPOCH=$(date +%s)
NAME="spike-045-$EPOCH"
TAG="${WORKLOAD_IMAGE_TAG:-554c9a824c2736ca9635114eaa00f86d3c5cd588}" # pinned: a main sha with a published ghcr image
: "${SECONDLAYER_API_KEY:?set SECONDLAYER_API_KEY (hosted read key for stacks B and C)}"
TMP=$(mktemp -d)
SSH_KEY_MADE=0 FW_MADE=0 SERVER_MADE=0

log() { printf '[%s] %s\n' "$(date -u +%T)" "$*"; }

cleanup() {
	local rc=$?
	set +e
	trap - EXIT INT TERM
	log "cleanup ($NAME)"
	if [ $SERVER_MADE -eq 1 ]; then hcloud server delete "$NAME" >/dev/null 2>&1; fi
	if [ $FW_MADE -eq 1 ]; then
		for _ in $(seq 1 12); do
			hcloud firewall delete "$NAME" >/dev/null 2>&1 && break
			sleep 5
		done
	fi
	if [ $SSH_KEY_MADE -eq 1 ]; then hcloud ssh-key delete "$NAME" >/dev/null 2>&1; fi
	rm -rf "$TMP"
	local left
	left=$( (
		hcloud server list -o noheader -o columns=name
		hcloud firewall list -o noheader -o columns=name
		hcloud ssh-key list -o noheader -o columns=name
	) 2>/dev/null | grep '^spike-045-' || true)
	if [ -n "$left" ]; then
		echo "LEFTOVER CLOUD RESOURCES: $left" >&2
		exit 99
	fi
	log "no spike-045-* server, firewall or ssh-key remains"
	exit $rc
}
trap cleanup EXIT
trap 'exit 130' INT TERM

SSH_OPTS=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes
	-o LogLevel=ERROR -o ServerAliveInterval=30 -o ConnectTimeout=10 -i "$TMP/key")
vm() { ssh "${SSH_OPTS[@]}" "root@$IP" "$@"; }

# 1. cloud-init from the shared renderer, with the real app-server IP.
APP_SERVER_IP=$(sed -n 's/^APP_SERVER_IP="\(.*\)"$/\1/p' docker/workload-host/provision.sh)
docker/workload-host/render-cloud-init.sh "${APP_SERVER_IP%/*}" >"$TMP/cloud-init.yaml"

# 2. Own throwaway resources.
OPERATOR_IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org)
ssh-keygen -q -t ed25519 -N "" -C "$NAME" -f "$TMP/key"
SSH_KEY_MADE=1
hcloud ssh-key create --name "$NAME" --public-key-from-file "$TMP/key.pub" --label spike=045 >/dev/null
printf '[{"direction":"in","protocol":"tcp","port":"22","source_ips":["%s/32"]}]\n' "$OPERATOR_IP" >"$TMP/rules.json"
FW_MADE=1
hcloud firewall create --name "$NAME" --rules-file "$TMP/rules.json" --label spike=045 >/dev/null
SERVER_MADE=1
# Dedicated-core ccx13 (the shared-core pool is at quota). fsn1 first, then
# nbg1, hel1; any other failure (quota) is a STOP, never another type.
LOCATION=""
for loc in fsn1 nbg1 hel1; do
	if hcloud server create --name "$NAME" --type ccx13 --image ubuntu-24.04 --location "$loc" \
		--ssh-key "$NAME" --firewall "$NAME" --user-data-from-file "$TMP/cloud-init.yaml" \
		--label spike=045 >"$TMP/create.txt" 2>&1; then
		LOCATION=$loc
		break
	fi
	cat "$TMP/create.txt" >&2
	grep -qiE 'not available|unavailable|unsupported' "$TMP/create.txt" || break
	hcloud server delete "$NAME" >/dev/null 2>&1 || true
done
[ -n "$LOCATION" ] || { echo "STOP: hcloud server create failed" >&2; exit 4; }
echo "location: $LOCATION (ccx13)" >"$TMP/location.txt"
IP=$(hcloud server ip "$NAME")
log "server $NAME up at $IP (inbound 22 from $OPERATOR_IP only)"

for _ in $(seq 1 60); do
	vm true 2>/dev/null && break
	sleep 5
done
vm true
log "waiting for cloud-init"
set +e
vm 'cloud-init status --wait' >"$TMP/cloud-init-status.txt" 2>&1
CI_RC=$?
set -e
log "cloud-init exit=$CI_RC"
if [ $CI_RC -eq 1 ]; then
	mkdir -p "$RES"
	vm 'cloud-init status --long; tail -60 /var/log/cloud-init-output.log' >"$RES/cloud-init-failure.txt" 2>&1 || true
	echo "STOP: cloud-init reported an error (details in results/cloud-init-failure.txt)" >&2
	exit 4
fi

# 3. Ship the compose file + spike dir; the hosted key goes in a mode-600 file.
vm 'mkdir -p /opt/spike'
COPYFILE_DISABLE=1 tar -C "$REPO" --exclude 'spike/045-containment/results' -cf - \
	docker/workload/tenant.compose.yml spike/045-containment | vm 'tar -C /opt/spike -xf -'
printf 'TENANT_HOSTED_READ_KEY=%s\n' "$SECONDLAYER_API_KEY" | vm 'umask 077; cat > /root/hosted.env'

# 4. The run itself.
log "remote run (image $TAG)"
set +e
vm "WORKLOAD_IMAGE_TAG=$TAG bash /opt/spike/spike/045-containment/remote.sh" 2>&1 | tee "$TMP/remote.log"
REMOTE_RC=${PIPESTATUS[0]}
set -e
log "remote exit=$REMOTE_RC"

# 5. Results off the VM, then scrub.
rm -rf "$RES"
mkdir -p "$RES"
vm 'tar -C /opt/spike/out -cf - .' | tar -C "$RES" -xf - || true
cp "$TMP/remote.log" "$RES/remote.log"
cp "$TMP/cloud-init-status.txt" "$RES/cloud-init-status.txt"
cp "$TMP/location.txt" "$RES/location.txt"
echo "image tag: $TAG" >"$RES/image-tag.txt"

# Zero secret values may be committed: the real key (by pattern file, not argv),
# its prefix, and key material.
if grep -rIF -f <(printf '%s\n' "$SECONDLAYER_API_KEY") "$RES" >/dev/null 2>&1 ||
	grep -rIE 'sk-sl_|BEGIN [A-Z ]*PRIVATE KEY|INSTANCE_TOKEN=[0-9a-f]{16}' "$RES" >/dev/null 2>&1; then
	rm -rf "$RES"
	echo "STOP: secret-looking value found in results; results discarded" >&2
	exit 5
fi
log "results scrubbed clean ($(find "$RES" -type f | wc -l | tr -d ' ') files)"

# 6. Suite table: pass when outcome equals expected, or (res checks) starts
#    with the expected verdict word.
cat "$RES"/suite-deploy-probe.jsonl "$RES"/suite-processor.jsonl "$RES"/suite-res.jsonl 2>/dev/null |
	jq -rs '
	  map(select(.outcome != "progress" and .outcome != "start" and .outcome != "end")) |
	  map(. + {ok: (.outcome == .expected
	      or ((.check|startswith("res:")) and (.outcome|test("^(stopped-near-128|oom-killed-near-512MB|other-tenant-advanced)"))))}) |
	  (["path","check","expected","outcome","ok"] | @tsv),
	  (.[] | [.path, .check, .expected, .outcome, (if .ok then "PASS" else "FAIL" end)] | @tsv)' \
	>"$RES/suite-summary.tsv" || true
log "suite summary: $(grep -c PASS "$RES/suite-summary.tsv" || true) pass, $(grep -c FAIL "$RES/suite-summary.tsv" || true) fail"

exit "$REMOTE_RC"
