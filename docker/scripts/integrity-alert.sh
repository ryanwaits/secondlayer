#!/usr/bin/env bash
# Live /health/integrity page → Slack. Unfillable gaps and broken canonical
# links are already-decided incidents (same class as health-alert CRITICAL).
# Pages --force / recovers --recovery through slack-gate; never evaluate().
# gaps_detected / degraded stay quiet (auto-backfill still running).
# curl/HTTP/JSON failure stays quiet (health-alert WARN covers a down indexer).
#
# Requires SLACK_WEBHOOK_URL (read from /opt/secondlayer/docker/.env via the
# systemd unit's EnvironmentFile). A dedicated state file dedupes: one page
# per incident, all-clear on recovery.
set -uo pipefail

# shellcheck source=lib/post-slack.sh
. "$(dirname "$0")/lib/post-slack.sh"

INDEXER_URL="${INDEXER_URL:-${STAGING_INDEXER_URL:-http://127.0.0.1:3700}}"
STATE_FILE="${INTEGRITY_ALERT_STATE_FILE:-/var/run/secondlayer-integrity-alert.state}"
DECIDE="${INTEGRITY_ALERT_TS:-$REPO_ROOT/scripts/ops/integrity-alert.ts}"

had=0
[ -f "$STATE_FILE" ] && had=1

if ! body=$(curl -fsS --max-time 15 "$INDEXER_URL/health/integrity" 2>&1); then
  echo "$(date -u +%FT%TZ) integrity-alert curl_failed: $body"
  exit 0
fi

if [ ! -x "$BUN_BIN" ] || [ ! -f "$DECIDE" ]; then
  echo "$(date -u +%FT%TZ) integrity-alert bun_or_script_missing"
  exit 0
fi

if ! decision=$(printf '%s' "$body" | "$BUN_BIN" "$DECIDE" --had-incident="$had" --fetch-ok=1); then
  echo "$(date -u +%FT%TZ) integrity-alert decide_failed"
  exit 0
fi

action=$(printf '%s' "$decision" | python3 -c "import json,sys; print(json.load(sys.stdin).get('action') or '')" 2>/dev/null || echo "")
reason=$(printf '%s' "$decision" | python3 -c "import json,sys; print(json.load(sys.stdin).get('reason') or '')" 2>/dev/null || echo "")
status=$(printf '%s' "$decision" | python3 -c "import json,sys; v=json.load(sys.stdin).get('status'); print(v if isinstance(v,str) else '')" 2>/dev/null || echo "")
message=$(printf '%s' "$decision" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message') or '')" 2>/dev/null || echo "")

echo "$(date -u +%FT%TZ) integrity-alert action=${action:-?} reason=${reason:-?} status=${status:-?}"

if [ "$action" = "page" ]; then
  if [ ! -f "$STATE_FILE" ]; then
    touch "$STATE_FILE" 2>/dev/null || true
    post_slack "$message" --force
  fi
  exit 0
fi

if [ "$action" = "recovery" ]; then
  rm -f "$STATE_FILE"
  post_slack "$message" --recovery
  exit 0
fi

exit 0
