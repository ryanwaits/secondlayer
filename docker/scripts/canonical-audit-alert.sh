#!/usr/bin/env bash
# Canonical archive coverage audit → Slack. floor-audit proves the DECODED
# planes reach genesis; this proves the CANONICAL tables themselves are a
# complete, linked, duplicate-free chain from genesis to the finalized height.
# Runs canonical-audit.ts inside the indexer container with the bound resolved
# automatically at the burn-confirmation finality boundary, and pages Slack
# when the audit reports anything but complete — the 2026-08-11 fork-point
# corruptions sat invisible for months precisely because nothing ran this.
#
# Requires SLACK_WEBHOOK_URL (read from /opt/secondlayer/docker/.env via the
# systemd unit's EnvironmentFile). A dedicated state file dedupes: a broken
# chain is a standing condition until repaired, so it pages once per incident
# and posts an all-clear when the audit passes again.
set -uo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/secondlayer/docker}"
INDEXER_CONTAINER="${INDEXER_CONTAINER:-secondlayer-indexer-1}"
AUDIT_CMD="${CANONICAL_AUDIT_CMD:-bun run packages/indexer/src/archive/canonical-audit.ts}"
# Hard cap so a hung audit can never wedge the systemd oneshot — on timeout the
# wrapper exits non-zero (124) and pages, rather than blocking forever.
AUDIT_TIMEOUT="${CANONICAL_AUDIT_TIMEOUT:-900}"
STATE_FILE="${CANONICAL_AUDIT_STATE_FILE:-/var/run/secondlayer-canonical-audit.state}"
REPORT_DIR="${CANONICAL_AUDIT_REPORT_DIR:-/opt/secondlayer/data/audits}"
WEBHOOK="${SLACK_WEBHOOK_URL:-}"

post_slack() {
  [ -n "$WEBHOOK" ] || return 0
  local text="$1"
  local payload
  payload=$(python3 -c "import json,sys; print(json.dumps({'text': sys.argv[1]}))" "$text" 2>/dev/null \
    || echo "{\"text\":\"secondlayer canonical-audit alert\"}")
  curl -s -X POST -H 'Content-Type: application/json' -d "$payload" "$WEBHOOK" >/dev/null || true
}

# Run inside the live indexer container (it has the source-DB env). Fall back
# to a throwaway container if the live one isn't up.
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$INDEXER_CONTAINER"; then
  output=$(timeout "$AUDIT_TIMEOUT" docker exec \
    -e STACKS_EXPECTED_FROM_BLOCK=0 -e STACKS_EXPECTED_TO_BLOCK=auto \
    "$INDEXER_CONTAINER" $AUDIT_CMD 2>&1)
  status=$?
elif [ -d "$COMPOSE_DIR" ]; then
  output=$(cd "$COMPOSE_DIR" && timeout "$AUDIT_TIMEOUT" docker compose run --rm \
    -e STACKS_EXPECTED_FROM_BLOCK=0 -e STACKS_EXPECTED_TO_BLOCK=auto \
    indexer $AUDIT_CMD 2>&1)
  status=$?
else
  output="canonical-audit: indexer container '$INDEXER_CONTAINER' not running and no compose dir at $COMPOSE_DIR"
  status=3
fi

echo "$(date -u +%FT%TZ) canonical-audit exit=$status"
echo "$output"

# Preserve every report — these are the raw material for signed audit history.
if [ -d "$REPORT_DIR" ] || mkdir -p "$REPORT_DIR" 2>/dev/null; then
  printf '%s\n' "$output" > "$REPORT_DIR/canonical-audit-$(date -u +%Y%m%dT%H%M%SZ).json" 2>/dev/null || true
fi

if [ "$status" -eq 0 ]; then
  # Complete genesis→finalized. If we previously alerted, send the all-clear.
  if [ -f "$STATE_FILE" ]; then
    rm -f "$STATE_FILE"
    post_slack "✅ secondlayer canonical-audit recovered — chain complete genesis→finalized again"
  fi
  exit 0
fi

# Failure (incomplete chain, or the audit couldn't run). Surface the continuity
# counters for the page; fall back to the output tail.
summary=$(printf '%s\n' "$output" \
  | grep -E '"(complete|healthy|gap_count|missing_blocks|broken_link_count|duplicate_height_count)":' \
  | tr -d ' ' | tr '\n' ' ')
[ -n "$summary" ] || summary=$(printf '%s\n' "$output" | tail -n 3 | tr '\n' ' ')
msg="🔴 secondlayer canonical-audit (exit $status): $summary"

# Alert once per incident: skip if the state file already exists.
if [ ! -f "$STATE_FILE" ]; then
  touch "$STATE_FILE" 2>/dev/null || true
  post_slack "$msg"
fi
exit 1
