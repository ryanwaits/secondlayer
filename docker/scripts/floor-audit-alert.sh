#!/usr/bin/env bash
# Decoder genesis-floor regression check → Slack. The other half of the index
# contract: health-alert.sh proves decoders are caught up to TIP; this proves
# they're complete down to GENESIS. Runs floor-audit.ts inside the decoder
# container (which has SOURCE_DATABASE_URL) and pages Slack when a decoder's
# floor regressed above baseline (history went missing) or a new decoder shipped
# without a recorded baseline.
#
# Requires SLACK_WEBHOOK_URL (read from /opt/secondlayer/docker/.env via the
# systemd unit's EnvironmentFile). A dedicated state file dedupes: a floored
# decoder is a standing condition until it's backfilled + baselined, so it pages
# once per incident, not every day, and posts an all-clear when it recovers.
set -uo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/secondlayer/docker}"
DECODER_CONTAINER="${DECODER_CONTAINER:-secondlayer-decoder-1}"
AUDIT_CMD="${FLOOR_AUDIT_CMD:-bun run packages/indexer/src/decode/floor-audit.ts}"
STATE_FILE="${FLOOR_AUDIT_STATE_FILE:-/var/run/secondlayer-floor-audit.state}"
WEBHOOK="${SLACK_WEBHOOK_URL:-}"

post_slack() {
  [ -n "$WEBHOOK" ] || return 0
  local text="$1"
  local payload
  payload=$(python3 -c "import json,sys; print(json.dumps({'text': sys.argv[1]}))" "$text" 2>/dev/null \
    || echo "{\"text\":\"secondlayer floor-audit alert\"}")
  curl -s -X POST -H 'Content-Type: application/json' -d "$payload" "$WEBHOOK" >/dev/null || true
}

# Run the audit inside the live decoder container (lighter than `compose run`,
# and it already has the source-DB env). Fall back to a throwaway container if
# the live one isn't up.
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DECODER_CONTAINER"; then
  output=$(docker exec "$DECODER_CONTAINER" $AUDIT_CMD 2>&1)
  status=$?
elif [ -d "$COMPOSE_DIR" ]; then
  output=$(cd "$COMPOSE_DIR" && docker compose run --rm decoder $AUDIT_CMD 2>&1)
  status=$?
else
  output="floor-audit: decoder container '$DECODER_CONTAINER' not running and no compose dir at $COMPOSE_DIR"
  status=2
fi

echo "$(date -u +%FT%TZ) floor-audit exit=$status"
echo "$output"

if [ "$status" -eq 0 ]; then
  # Genesis-complete. If we previously alerted, send the all-clear once.
  if [ -f "$STATE_FILE" ]; then
    rm -f "$STATE_FILE"
    post_slack "✅ secondlayer floor-audit recovered — all decoders genesis-complete again"
  fi
  exit 0
fi

# Failure (floored / unbaselined, or the audit couldn't run). Summarize the
# salient lines for the page; fall back to the output tail.
summary=$(printf '%s\n' "$output" | grep -E 'FLOORED|UNBASELINED' | tr '\n' ' ')
[ -n "$summary" ] || summary=$(printf '%s\n' "$output" | tail -n 3 | tr '\n' ' ')
msg="🔴 secondlayer floor-audit (exit $status): $summary"

# Alert once per incident: skip if the state file already exists.
if [ ! -f "$STATE_FILE" ]; then
  touch "$STATE_FILE" 2>/dev/null || true
  post_slack "$msg"
fi
exit 1
