#!/usr/bin/env bash
# Host-only feeder IBD watchdog. Read-only: curl node/indexer, docker inspect,
# one SELECT, df. Never compose up/down, never restart, never touch Config.toml.
# Decided incidents page Slack --force (direct webhook; no bun/Jev on this box).
set -uo pipefail

STATE_FILE="${FEEDER_ALERT_STATE:-/var/run/secondlayer-feeder-alert.state}"
LOG_TS="$(date -u +%FT%TZ)"
STALL_SECONDS="${FEEDER_STALL_SECONDS:-3600}"
REPAGE_SECONDS="${FEEDER_REPAGE_SECONDS:-1800}"
# Node RPC briefly stops answering while IBD holds the chainstate lock; page only
# after this many consecutive unreadable runs (timer = 5m). Stalls page via STALL_SECONDS.
UNREADABLE_RUNS="${FEEDER_UNREADABLE_RUNS:-3}"
LAG_BLOCKS="${FEEDER_LAG_BLOCKS:-100}"
LAG_SECONDS="${FEEDER_LAG_SECONDS:-900}"
DISK_WARN_PCT="${FEEDER_DISK_WARN_PCT:-50}"
WRONG_MIN="${FEEDER_WRONG_MIN:-100000}"
STACKS="secondlayer-feeder-stacks-feeder-1"
INDEXER="secondlayer-feeder-indexer-feeder-1"
PG="secondlayer-feeder-postgres-feeder-1"

post_slack() {
  local text="$1"
  local mode="${2:-force}"
  [ -n "${SLACK_WEBHOOK_URL:-}" ] || return 0
  local payload
  payload=$(python3 -c "import json,sys; print(json.dumps({'text': sys.argv[1]}))" "$text" 2>/dev/null) \
    || payload='{"text":"stacks-feeder alert"}'
  curl -sS --max-time 15 -X POST -H 'Content-Type: application/json' \
    -d "$payload" "$SLACK_WEBHOOK_URL" >/dev/null || true
  echo "$LOG_TS posted mode=$mode"
}

state_get() {
  local key="$1"
  [ -f "$STATE_FILE" ] || { printf ''; return 0; }
  awk -F= -v k="$key" '$1==k{v=$2} END{print v}' "$STATE_FILE" 2>/dev/null || true
}

state_write() {
  cat >"$STATE_FILE" <<EOF
height=$1
height_at=$2
seen=$3
lag_at=$4
min_h=$5
disk=$6
last_page=$7
paged=$8
unreadable=$9
EOF
}

running() {
  local name="$1"
  docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null | grep -qx true
}

now=$(date +%s)
problems=()

if ! running "$STACKS"; then problems+=("$STACKS not running"); fi
if ! running "$INDEXER"; then problems+=("$INDEXER not running"); fi
if ! running "$PG"; then problems+=("$PG not running"); fi

info_json=$(curl -sS --max-time 15 localhost:20443/v2/info 2>/dev/null || true)
health_json=$(curl -sS --max-time 5 localhost:3700/health 2>/dev/null || true)
eval "$(python3 - "$info_json" "$health_json" <<'PY'
import json,sys
height, seen = -1, -1
try:
    height = int(json.loads(sys.argv[1]).get("stacks_tip_height") or -1)
except Exception:
    pass
try:
    seen = int(json.loads(sys.argv[2]).get("lastSeenHeight") or -1)
except Exception:
    pass
print(f"height={height}")
print(f"seen={seen}")
PY
)"

prev_unreadable=$(state_get unreadable)
[[ "$prev_unreadable" =~ ^[0-9]+$ ]] || prev_unreadable=0
unreadable=0
if [ "${height:- -1}" -lt 0 ]; then
  unreadable=$(( prev_unreadable + 1 ))
  if [ "$unreadable" -ge "$UNREADABLE_RUNS" ]; then
    problems+=("node /v2/info unreadable ${unreadable} runs")
  fi
fi
if [ "${seen:- -1}" -lt 0 ]; then
  problems+=("indexer /health unreadable")
fi

min_h=-1
max_h=-1
count=-1
if running "$PG"; then
  sql=$(docker exec "$PG" psql -U secondlayer -d secondlayer_feeder -tAc \
    "SELECT coalesce(min(block_height),-1), coalesce(max(block_height),-1), (SELECT reltuples::bigint FROM pg_class WHERE oid = 'vm_events'::regclass) FROM vm_events" 2>/dev/null || true)
  min_h=$(printf '%s' "$sql" | awk -F'|' '{print $1}' | tr -d ' ')
  max_h=$(printf '%s' "$sql" | awk -F'|' '{print $2}' | tr -d ' ')
  count=$(printf '%s' "$sql" | awk -F'|' '{print $3}' | tr -d ' ')
  [[ "$min_h" =~ ^-?[0-9]+$ ]] || min_h=-1
fi
if [ "$min_h" -ge "$WRONG_MIN" ]; then
  problems+=("vm_events.min=$min_h (not genesis-adjacent)")
fi

disk_pct=$(df -P /data/feeder | awk 'NR==2{print $5}' | tr -d '%')
[[ "$disk_pct" =~ ^[0-9]+$ ]] || disk_pct=-1
if [ "$disk_pct" -ge "$DISK_WARN_PCT" ]; then
  problems+=("/data/feeder ${disk_pct}% full")
fi

trunc_node=$(docker logs --since 10m "$STACKS" 2>&1 | grep -c "vm trace truncated" || true)
trunc_idx=$(docker logs --since 10m "$INDEXER" 2>&1 | grep -c "vm_event truncated" || true)
http413=$(docker logs --since 10m "$INDEXER" 2>&1 | grep -cE "Payload Too Large|Request Entity Too Large" || true)
trunc_node=${trunc_node##*$'\n'}
trunc_idx=${trunc_idx##*$'\n'}
http413=${http413##*$'\n'}
[[ "$trunc_node" =~ ^[0-9]+$ ]] || trunc_node=0
[[ "$trunc_idx" =~ ^[0-9]+$ ]] || trunc_idx=0
[[ "$http413" =~ ^[0-9]+$ ]] || http413=0
if [ "$trunc_node" -gt 0 ] || [ "$trunc_idx" -gt 0 ]; then
  problems+=("truncated traces node=$trunc_node indexer=$trunc_idx")
fi
if [ "$http413" -gt 0 ]; then
  problems+=("indexer Payload Too Large count=$http413")
fi

prev_height=$(state_get height)
prev_height_at=$(state_get height_at)
prev_seen=$(state_get seen)
prev_lag_at=$(state_get lag_at)
prev_last_page=$(state_get last_page)
prev_paged=$(state_get paged)
[ -n "$prev_last_page" ] || prev_last_page=0
[ -n "$prev_paged" ] || prev_paged=0
[ -n "$prev_height_at" ] || prev_height_at=0
[ -n "$prev_lag_at" ] || prev_lag_at=0

# An unreadable run keeps the last known tip so a blip can't reset the stall clock.
if [ "$height" -lt 0 ] && [ -n "$prev_height" ] && [ "$prev_height" -ge 0 ]; then
  height="$prev_height"
fi

height_at="$now"
if [ -n "$prev_height" ] && [ "$height" = "$prev_height" ] && [ "$height" -ge 0 ]; then
  height_at="$prev_height_at"
  [ -n "$height_at" ] && [ "$height_at" != "0" ] || height_at="$now"
  stalled=$(( now - height_at ))
  if [ "$stalled" -ge "$STALL_SECONDS" ]; then
    problems+=("stacks tip $height unchanged $(( stalled / 60 ))m")
  fi
fi

lag_at=0
if [ "$height" -ge 0 ] && [ "$seen" -ge 0 ] && [ $(( height - seen )) -gt "$LAG_BLOCKS" ]; then
  if [ -n "$prev_lag_at" ] && [ "$prev_lag_at" != "0" ]; then
    lag_at="$prev_lag_at"
  else
    lag_at="$now"
  fi
  if [ $(( now - lag_at )) -ge "$LAG_SECONDS" ]; then
    problems+=("indexer lastSeenHeight=$seen lags tip=$height by $(( height - seen ))")
  fi
fi

echo "$LOG_TS height=$height seen=$seen min=$min_h max=$max_h n=$count disk=${disk_pct}% problems=${#problems[@]}"

if [ ${#problems[@]} -eq 0 ]; then
  if [ "$prev_paged" = "1" ]; then
    post_slack "✅ stacks-feeder recovered — height=$height indexer=$seen vm_events min=$min_h max=$max_h n=$count disk=${disk_pct}%" recovery
  fi
  state_write "$height" "$height_at" "$seen" "$lag_at" "$min_h" "$disk_pct" 0 0 "$unreadable"
  exit 0
fi

msg="🚨 stacks-feeder: $(printf '%s | ' "${problems[@]}")
height=$height seen=$seen vm_events min=$min_h max=$max_h n=$count disk=${disk_pct}%
ssh stacks-feeder"

should_page=0
if [ "$prev_paged" != "1" ]; then
  should_page=1
elif [ $(( now - prev_last_page )) -ge "$REPAGE_SECONDS" ]; then
  should_page=1
fi

if [ "$should_page" -eq 1 ]; then
  post_slack "$msg" force
  state_write "$height" "$height_at" "$seen" "$lag_at" "$min_h" "$disk_pct" "$now" 1 "$unreadable"
else
  state_write "$height" "$height_at" "$seen" "$lag_at" "$min_h" "$disk_pct" "$prev_last_page" 1 "$unreadable"
fi
exit 0
