#!/usr/bin/env bash
# Standalone testnet health check -> Slack. Never touches prod alerting state.
# Pages once per new problem, all-clear when the set empties. Needs
# SLACK_WEBHOOK_URL (the unit loads docker/.env for it; prod DB and node vars
# are dropped below). No-op until docker/testnet/.env exists.
set -uo pipefail

# shellcheck source=lib/post-slack.sh
. "$(dirname "$0")/lib/post-slack.sh"

# This check must never hold prod credentials, whatever the unit loaded.
for v in $(compgen -e | grep -E '^(STACKS_|DATABASE|POSTGRES_)'); do unset "$v"; done

COMPOSE_DIR="${COMPOSE_DIR:-/opt/secondlayer/docker}"
STATE_FILE="${TESTNET_HEALTH_STATE_FILE:-/var/run/secondlayer-testnet-health.state}"
HEALTH_URL="${TESTNET_HEALTH_URL:-http://127.0.0.1:3701/health}"
HIRO_URL="${TESTNET_HIRO_INFO_URL:-https://api.testnet.hiro.so/v2/info}"
DISK_PATH="${TESTNET_DISK_PATH:-/data/bitcoin}"

[ -f "$COMPOSE_DIR/testnet/.env" ] || exit 0

json_field() { python3 -c 'import json,sys; v=json.load(sys.stdin).get(sys.argv[1]); print("" if v is None else v)' "$1" 2>/dev/null; }

problems=()

health=$(curl -fsS -m5 "$HEALTH_URL" 2>/dev/null) || health=""
ours=""
if [ -z "$health" ]; then
  problems+=("stall|testnet: indexer /health unreachable")
else
  ago=$(printf '%s' "$health" | json_field lastBlockReceivedSecondsAgo)
  ours=$(printf '%s' "$health" | json_field lastSeenHeight)
  if [ -z "$ago" ] || [ "${ago%.*}" -gt 900 ] 2>/dev/null; then
    problems+=("stall|testnet: no block received for ${ago:-unknown}s (limit 900s)")
  fi
fi

# A failed Hiro call is not a page.
theirs=$(curl -fsS -m10 "$HIRO_URL" 2>/dev/null | json_field stacks_tip_height) || theirs=""
if [[ "$ours" =~ ^[0-9]+$ && "$theirs" =~ ^[0-9]+$ ]]; then
  if [ $((theirs - ours)) -gt 200 ]; then
    problems+=("behind|testnet: $((theirs - ours)) blocks behind chain (ours $ours, tip $theirs)")
  fi
  if [ $((ours - theirs)) -gt 1000 ]; then
    problems+=("reset|testnet: reset suspected, ours $ours is ahead of tip $theirs")
  fi
fi

unhealthy=$(docker ps --filter label=com.docker.compose.project=secondlayer-testnet --filter health=unhealthy -q 2>/dev/null | wc -l | tr -d ' ')
if [ "${unhealthy:-0}" -gt 0 ]; then
  problems+=("containers|testnet: $unhealthy unhealthy container(s)")
fi

used=$(df --output=pcent "$DISK_PATH" 2>/dev/null | tail -1 | tr -dc '0-9')
if [ -n "$used" ] && [ "$used" -ge 80 ]; then
  if [ "$used" -ge 90 ]; then
    docker compose -p secondlayer-testnet -f "$COMPOSE_DIR/testnet/docker-compose.yml" --env-file "$COMPOSE_DIR/testnet/.env" stop >/dev/null 2>&1
    problems+=("disk|testnet: $DISK_PATH at ${used}%, stack stopped")
  else
    problems+=("disk|testnet: $DISK_PATH at ${used}% (stack stops at 90%)")
  fi
fi

prev=""
[ -f "$STATE_FILE" ] && prev=$(cat "$STATE_FILE")
keys=""
for p in ${problems[@]+"${problems[@]}"}; do
  key="${p%%|*}"; msg="${p#*|}"
  keys+="$key "
  case " $prev " in *" $key "*) ;; *) post_slack "$msg" --force ;; esac
done
if [ -z "$keys" ] && [ -n "${prev// /}" ]; then
  post_slack "testnet: recovered" --recovery
fi
printf '%s' "$keys" > "$STATE_FILE"
