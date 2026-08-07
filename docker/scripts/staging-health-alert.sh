#!/usr/bin/env bash
# Deep prod health check → Slack. The third leg of the index contract:
# health-alert.sh proves the API answers and containers are up (liveness);
# floor-audit-alert.sh proves decoders are complete down to GENESIS; this runs
# staging-health.ts to prove the data is FRESH and well-shaped at the tip —
# service states, decoder lag bands, streams lag, dumps freshness, and recent
# canonical blocks with a zero timestamp.
#
# This probe used to run in GitHub Actions on a */30 cron. Hosted runners were
# never assigned to most of those firings, so it effectively ran ~4x/day and
# paged red when a starved runner was cancelled. Running it here makes the
# cadence real and takes GitHub's runner queue out of the alerting path.
#
# Requires SLACK_WEBHOOK_URL (read from /opt/secondlayer/docker/.env via the
# systemd unit's EnvironmentFile). State file dedupes: a stale decoder is a
# standing condition until it catches up, so it pages once per incident and
# posts an all-clear on recovery.
set -uo pipefail

REPO_DIR="${REPO_DIR:-/opt/secondlayer}"
HEALTH_SCRIPT="${STAGING_HEALTH_SCRIPT:-scripts/ci/staging-health.ts}"
# Hard cap so a hung probe can never wedge the systemd oneshot — on timeout the
# wrapper exits non-zero (124) and pages, rather than blocking forever.
HEALTH_TIMEOUT="${STAGING_HEALTH_RUN_TIMEOUT:-120}"
STATE_FILE="${STAGING_HEALTH_STATE_FILE:-/var/run/secondlayer-staging-health.state}"
WEBHOOK="${SLACK_WEBHOOK_URL:-}"
BUN_BIN="${BUN_BIN:-}"

if [ -z "$BUN_BIN" ]; then
  # systemd starts this with a minimal PATH; bun lives under root's home.
  if [ -x /root/.bun/bin/bun ]; then
    BUN_BIN=/root/.bun/bin/bun
  else
    BUN_BIN=$(command -v bun || true)
  fi
fi

post_slack() {
  [ -n "$WEBHOOK" ] || return 0
  local text="$1"
  local payload
  payload=$(python3 -c "import json,sys; print(json.dumps({'text': sys.argv[1]}))" "$text" 2>/dev/null \
    || echo "{\"text\":\"secondlayer staging-health alert\"}")
  curl -s -X POST -H 'Content-Type: application/json' -d "$payload" "$WEBHOOK" >/dev/null || true
}

# The zero-timestamp check needs a host-reachable SOURCE DB. docker/.env ships
# DATABASE_URL empty (the containers get theirs from compose) and POSTGRES_PORT
# is a full bind spec like "127.0.0.1:5432", not a port — so build the URL from
# the parts rather than reusing either. Password is percent-encoded: it is
# generated and may contain characters that are not URL-safe.
if [ -z "${STAGING_DATABASE_URL:-}" ] && [ -n "${POSTGRES_USER:-}" ] && [ -n "${POSTGRES_DB:-}" ]; then
  db_hostport="${STAGING_HEALTH_DB_HOSTPORT:-127.0.0.1:5432}"
  db_pass=$(python3 -c "import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))" \
    "${POSTGRES_PASSWORD:-}" 2>/dev/null || echo "")
  export STAGING_DATABASE_URL="postgresql://${POSTGRES_USER}:${db_pass}@${db_hostport}/${POSTGRES_DB}"
fi

if [ -z "$BUN_BIN" ]; then
  output="staging-health: bun not found (looked at /root/.bun/bin/bun and PATH)"
  status=2
elif [ ! -d "$REPO_DIR" ]; then
  output="staging-health: repo dir not found at $REPO_DIR"
  status=2
else
  output=$(cd "$REPO_DIR" && timeout "$HEALTH_TIMEOUT" "$BUN_BIN" "$HEALTH_SCRIPT" 2>&1)
  status=$?
fi

echo "$(date -u +%FT%TZ) staging-health exit=$status"
echo "$output"

if [ "$status" -eq 0 ]; then
  # Healthy. If we previously alerted, send the all-clear once.
  if [ -f "$STATE_FILE" ]; then
    rm -f "$STATE_FILE"
    post_slack "✅ secondlayer staging-health recovered — tip data fresh and well-shaped again"
  fi
  exit 0
fi

# Failure. staging-health.ts prints one line per failure to stderr plus a
# trailing count; surface those rather than the whole notice-heavy log.
summary=$(printf '%s\n' "$output" | grep -vE "^(streams\.dumps|[a-z_]+ decoder status=)" \
  | grep -iE 'unavailable|stuck|missing|failed|lag [0-9]+s|status .[a-z]+.|HTTP [0-9]{3}' | tr '\n' ' ')
[ -n "$summary" ] || summary=$(printf '%s\n' "$output" | tail -n 3 | tr '\n' ' ')
msg="🔴 secondlayer staging-health (exit $status): $summary"

# Alert once per incident: skip if the state file already exists.
if [ ! -f "$STATE_FILE" ]; then
  touch "$STATE_FILE" 2>/dev/null || true
  post_slack "$msg"
fi
exit 1
