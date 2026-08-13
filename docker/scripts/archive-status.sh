#!/usr/bin/env bash
# Refresh the archive's `status.json` — hourly, independent of publishing.
#
# Status is the liveness signal, so it has to keep moving even when nothing is
# published. A publish cycle runs weekly; if status only refreshed with it, a
# consumer could not distinguish "healthy, nothing new to publish" from "the
# publisher died six days ago". The object is cache-60s for the same reason.
#
# Cheap by construction: one DB read and one PUT. It never promotes and never
# writes archive data, so it is safe to run often and safe to fail.
set -uo pipefail

INDEXER_CONTAINER="${INDEXER_CONTAINER:-secondlayer-indexer-1}"
STATUS_TIMEOUT="${ARCHIVE_STATUS_TIMEOUT:-300}"
STATE_FILE="${ARCHIVE_STATUS_STATE_FILE:-/var/run/secondlayer-archive-status.state}"
WEBHOOK="${SLACK_WEBHOOK_URL:-}"

post_slack() {
  [ -n "$WEBHOOK" ] || return 0
  local text="$1"
  local payload
  payload=$(python3 -c "import json,sys; print(json.dumps({'text': sys.argv[1]}))" "$text" 2>/dev/null \
    || echo "{\"text\":\"secondlayer archive status alert\"}")
  curl -s -X POST -H 'Content-Type: application/json' -d "$payload" "$WEBHOOK" >/dev/null || true
}

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$INDEXER_CONTAINER"; then
  echo "$(date -u +%FT%TZ) archive-status: container not running"
  exit 1
fi

out=$(timeout "$STATUS_TIMEOUT" docker exec "$INDEXER_CONTAINER" \
  bun run packages/indexer/src/archive/publish-status.ts --apply 2>&1)
status=$?
STATE=$(printf '%s' "$out" | grep -o '"state": *"[^"]*"' | sed 's/.*: *"//;s/"//')
echo "$(date -u +%FT%TZ) archive-status exit=$status state=${STATE:-unknown}"

if [ "$status" -ne 0 ]; then
  if [ ! -f "$STATE_FILE" ]; then
    touch "$STATE_FILE" 2>/dev/null || true
    post_slack "🔴 secondlayer archive status refresh failed (exit $status)"
  fi
  exit 1
fi

# Page on an unhealthy archive, once per incident. `lagging` is the normal
# steady state — the archive trails the chain tip by design — so it is
# explicitly not an alert.
case "$STATE" in
  fresh|lagging)
    if [ -f "$STATE_FILE" ]; then
      rm -f "$STATE_FILE"
      post_slack "✅ secondlayer archive healthy again (${STATE})"
    fi
    ;;
  *)
    if [ ! -f "$STATE_FILE" ]; then
      touch "$STATE_FILE" 2>/dev/null || true
      post_slack "🔴 secondlayer archive status is ${STATE} — see status.json"
    fi
    ;;
esac

exit 0
