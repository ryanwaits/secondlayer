#!/usr/bin/env bash
# Dumb prod health check → Slack. Replaces the AI ops agent as the single
# alert channel. Two independent tiers:
#
#   WARN     — curl the public status endpoint and check compose for
#              unhealthy/exited containers. Pages once per incident, all-clear
#              on recovery. Proxy signal; a flaky container is not necessarily
#              an outage.
#   CRITICAL — the actual product invariant: is the canonical chain tip
#              advancing. Tip unchanged for 15+ minutes (3 runs at the 5-min
#              cadence; Stacks blocks target ~5-10s, so 15 minutes of zero
#              progress is unambiguous) pages, and RE-PAGES every 30 minutes
#              while the stall is outstanding — an 8-hour incident is ~16
#              pages, not 1. A tip that cannot be read at all (postgres down)
#              is itself a CRITICAL page, not a script crash.
#
# Requires SLACK_WEBHOOK_URL (read from /opt/secondlayer/docker/.env via the
# systemd unit's EnvironmentFile). Two state files, one per tier, so a
# standing WARN and a standing CRITICAL are tracked and cleared independently.
set -uo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/secondlayer/docker}"
STATUS_URL="${HEALTH_STATUS_URL:-https://api.secondlayer.tools/public/status}"
WEBHOOK="${SLACK_WEBHOOK_URL:-}"

HEALTH_STATE_DIR="${HEALTH_STATE_DIR:-/var/run}"
WARN_STATE_FILE="${HEALTH_WARN_STATE_FILE:-$HEALTH_STATE_DIR/secondlayer-health-alert-warn.state}"
CRITICAL_STATE_FILE="${HEALTH_CRITICAL_STATE_FILE:-$HEALTH_STATE_DIR/secondlayer-health-alert-critical.state}"

# Ingest-progress tuning. 900s (15m) before a first CRITICAL page; 1800s
# (30m) between re-pages while the stall is outstanding.
CRITICAL_STALL_SECONDS=900
CRITICAL_REPAGE_SECONDS=1800

INDEXER_CONTAINER="${INDEXER_CONTAINER:-secondlayer-indexer-1}"
NODE_CONTAINER="${NODE_CONTAINER:-secondlayer-stacks-node-1}"
PG_SERVICE="${PG_SERVICE:-postgres}"

post_slack() {
  [ -n "$WEBHOOK" ] || return 0
  local text="$1"
  local payload
  payload=$(python3 -c "import json,sys; print(json.dumps({'text': sys.argv[1]}))" "$text" 2>/dev/null \
    || echo "{\"text\":\"secondlayer health-alert\"}")
  curl -s -X POST -H 'Content-Type: application/json' -d "$payload" "$WEBHOOK" >/dev/null || true
}

state_get() {
  local file="$1" key="$2"
  [ -f "$file" ] || { printf ''; return 0; }
  awk -F= -v k="$key" '$1==k{v=$2} END{print v}' "$file" 2>/dev/null || true
}

state_write() {
  local file="$1" tip="$2" first_seen="$3" last_page="$4"
  {
    printf 'tip=%s\n' "$tip"
    printf 'first_seen_epoch=%s\n' "$first_seen"
    printf 'last_page_epoch=%s\n' "$last_page"
  } > "$file" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# WARN tier: public status endpoint + compose container health (unchanged
# from the original single-tier script, just its own state file now).
# ---------------------------------------------------------------------------
problems=()

http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$STATUS_URL" || echo "000")
if [ "$http_code" != "200" ]; then
  problems+=("status endpoint $STATUS_URL returned $http_code")
fi

if [ -d "$COMPOSE_DIR" ]; then
  bad=$(cd "$COMPOSE_DIR" && docker compose ps --format '{{.Name}} {{.Status}}' 2>/dev/null \
    | grep -Ei 'unhealthy|exited|restarting' || true)
  if [ -n "$bad" ]; then
    problems+=("containers: $(echo "$bad" | tr '\n' '; ')")
  fi
fi

warn_exit=0
if [ ${#problems[@]} -eq 0 ]; then
  if [ -f "$WARN_STATE_FILE" ]; then
    rm -f "$WARN_STATE_FILE"
    post_slack "✅ secondlayer prod recovered — status 200, all containers healthy"
  fi
else
  warn_exit=1
  msg="🔴 secondlayer prod health: $(printf '%s | ' "${problems[@]}")"
  echo "$(date -u +%FT%TZ) $msg"
  # Alert once per incident: skip if the state file already exists.
  if [ ! -f "$WARN_STATE_FILE" ]; then
    touch "$WARN_STATE_FILE" 2>/dev/null || true
    post_slack "$msg"
  fi
fi

# ---------------------------------------------------------------------------
# CRITICAL tier: canonical tip progress — the actual product invariant.
# ---------------------------------------------------------------------------
default_tip_query() {
  (cd "$COMPOSE_DIR" 2>/dev/null && docker compose exec -T "$PG_SERVICE" \
    psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" -tAc \
    'SELECT max(height) FROM blocks WHERE canonical=true') 2>/dev/null
}

if [ -n "${TIP_QUERY_CMD:-}" ]; then
  tip_raw=$(eval "$TIP_QUERY_CMD" 2>/dev/null || true)
else
  tip_raw=$(default_tip_query || true)
fi
tip_raw=$(printf '%s' "$tip_raw" | tr -d '[:space:]')

if [[ "$tip_raw" =~ ^[0-9]+$ ]]; then
  tip_value="$tip_raw"
else
  tip_value="unreadable"
fi

now_epoch=$(date +%s)
prev_tip=$(state_get "$CRITICAL_STATE_FILE" tip)
prev_first_seen=$(state_get "$CRITICAL_STATE_FILE" first_seen_epoch)
prev_last_page=$(state_get "$CRITICAL_STATE_FILE" last_page_epoch)
[ -n "$prev_last_page" ] || prev_last_page=0

critical_exit=0

if [ -n "$prev_tip" ] && [ "$tip_value" = "$prev_tip" ]; then
  # Tip unchanged since the last observation (includes "unreadable" repeating
  # while postgres stays unreachable).
  first_seen_epoch="$prev_first_seen"
  [ -n "$first_seen_epoch" ] || first_seen_epoch="$now_epoch"
  stalled_seconds=$(( now_epoch - first_seen_epoch ))

  # An unreadable tip is unambiguous — no grace period. A merely-unchanged
  # numeric tip needs the full stall window to rule out normal block-time
  # jitter (a single 5-min run with no new block is not unusual on its own).
  if [ "$tip_value" = "unreadable" ] || [ "$stalled_seconds" -ge "$CRITICAL_STALL_SECONDS" ]; then
    critical_exit=1
    duration_minutes=$(( stalled_seconds / 60 ))
    if [ "$tip_value" = "unreadable" ]; then
      critical_body="cannot read canonical tip — postgres unreachable for ${duration_minutes}m.
Archive, decoders, and /v1 status cannot be confirmed."
    else
      critical_body="chain ingest STALLED — canonical tip $tip_value unchanged for ${duration_minutes}m.
Archive, decoders, and /v1 are frozen behind it."
    fi

    if [ "$prev_last_page" -eq 0 ] || [ $(( now_epoch - prev_last_page )) -ge "$CRITICAL_REPAGE_SECONDS" ]; then
      critical_msg="🚨 CRITICAL: ${critical_body}
First checks: docker logs $INDEXER_CONTAINER --tail 50
              docker logs $NODE_CONTAINER --tail 20"
      echo "$(date -u +%FT%TZ) $critical_msg"
      post_slack "$critical_msg"
      state_write "$CRITICAL_STATE_FILE" "$tip_value" "$first_seen_epoch" "$now_epoch"
    else
      state_write "$CRITICAL_STATE_FILE" "$tip_value" "$first_seen_epoch" "$prev_last_page"
    fi
  else
    state_write "$CRITICAL_STATE_FILE" "$tip_value" "$first_seen_epoch" "$prev_last_page"
  fi
else
  # Tip changed since the last observation, or this is the first run ever.
  was_critical=0
  if [ -f "$CRITICAL_STATE_FILE" ] && [ -n "$prev_last_page" ] && [ "$prev_last_page" != "0" ]; then
    was_critical=1
  fi
  if [ "$was_critical" -eq 1 ] && [ "$tip_value" != "unreadable" ]; then
    baseline="${prev_first_seen:-$now_epoch}"
    recovered_minutes=$(( (now_epoch - baseline) / 60 ))
    allclear_msg="✅ secondlayer chain ingest recovered — canonical tip advancing again (was stalled ${recovered_minutes}m, now at $tip_value)"
    echo "$(date -u +%FT%TZ) $allclear_msg"
    post_slack "$allclear_msg"
  fi
  rm -f "$CRITICAL_STATE_FILE" 2>/dev/null || true
  state_write "$CRITICAL_STATE_FILE" "$tip_value" "$now_epoch" 0
fi

final_exit=0
[ "$warn_exit" -eq 1 ] && final_exit=1
[ "$critical_exit" -eq 1 ] && final_exit=2
exit "$final_exit"
