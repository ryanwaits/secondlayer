#!/usr/bin/env bash
# Dumb prod health check → Slack. Replaces the AI ops agent as the single
# alert channel: curl the public status endpoint and check compose for
# unhealthy/exited containers; post to Slack only when something is wrong.
#
# Requires SLACK_WEBHOOK_URL (read from /opt/secondlayer/docker/.env via the
# systemd unit's EnvironmentFile). State file suppresses repeat alerts until
# the condition clears, so a down service pages once, not every 5 minutes.
set -uo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/secondlayer/docker}"
STATUS_URL="${HEALTH_STATUS_URL:-https://api.secondlayer.tools/public/status}"
STATE_FILE="${HEALTH_STATE_FILE:-/var/run/secondlayer-health-alert.state}"
WEBHOOK="${SLACK_WEBHOOK_URL:-}"

problems=()

# 1. Public status endpoint answers 200.
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$STATUS_URL" || echo "000")
if [ "$http_code" != "200" ]; then
  problems+=("status endpoint $STATUS_URL returned $http_code")
fi

# 2. No compose container is unhealthy or exited.
if [ -d "$COMPOSE_DIR" ]; then
  bad=$(cd "$COMPOSE_DIR" && docker compose ps --format '{{.Name}} {{.Status}}' 2>/dev/null \
    | grep -Ei 'unhealthy|exited|restarting' || true)
  if [ -n "$bad" ]; then
    problems+=("containers: $(echo "$bad" | tr '\n' '; ')")
  fi
fi

if [ ${#problems[@]} -eq 0 ]; then
  # Healthy. If we previously alerted, send the all-clear once.
  if [ -f "$STATE_FILE" ]; then
    rm -f "$STATE_FILE"
    [ -n "$WEBHOOK" ] && curl -s -X POST -H 'Content-Type: application/json' \
      -d '{"text":"✅ secondlayer prod recovered — status 200, all containers healthy"}' \
      "$WEBHOOK" >/dev/null || true
  fi
  exit 0
fi

msg="🔴 secondlayer prod health: $(printf '%s | ' "${problems[@]}")"
echo "$(date -u +%FT%TZ) $msg"

# Alert once per incident: skip if state file already exists.
if [ ! -f "$STATE_FILE" ]; then
  touch "$STATE_FILE" 2>/dev/null || true
  if [ -n "$WEBHOOK" ]; then
    payload=$(python3 -c "import json,sys; print(json.dumps({'text': sys.argv[1]}))" "$msg" 2>/dev/null \
      || echo "{\"text\":\"secondlayer prod health check failing\"}")
    curl -s -X POST -H 'Content-Type: application/json' -d "$payload" "$WEBHOOK" >/dev/null || true
  fi
fi
exit 1
