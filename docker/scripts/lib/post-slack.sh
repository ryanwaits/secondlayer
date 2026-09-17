# Shared Slack poster for systemd alert scripts.
# Routes through scripts/ops/slack-gate.ts (Jev). --force / --recovery skip the
# model. Fail-open: if bun or the gate is missing, curl the webhook directly.
#
# Usage: post_slack "$msg"
#        post_slack "$msg" --force
#        post_slack "$msg" --recovery

REPO_ROOT="${REPO_ROOT:-/opt/secondlayer}"
BUN_BIN="${BUN_BIN:-/root/.bun/bin/bun}"
SLACK_GATE="${SLACK_GATE:-$REPO_ROOT/scripts/ops/slack-gate.ts}"

_post_slack_direct() {
  local text="$1"
  [ -n "${SLACK_WEBHOOK_URL:-}" ] || return 0
  local payload
  payload=$(python3 -c "import json,sys; print(json.dumps({'text': sys.argv[1]}))" "$text" 2>/dev/null \
    || echo "{\"text\":\"secondlayer alert\"}")
  curl -s -X POST -H 'Content-Type: application/json' -d "$payload" "$SLACK_WEBHOOK_URL" >/dev/null || true
}

post_slack() {
  local text="$1"
  shift || true
  [ -n "${SLACK_WEBHOOK_URL:-}" ] || return 0
  if [ -x "$BUN_BIN" ] && [ -f "$SLACK_GATE" ]; then
    if printf '%s' "$text" | "$BUN_BIN" "$SLACK_GATE" "$@"; then
      return 0
    fi
  fi
  _post_slack_direct "$text"
}
