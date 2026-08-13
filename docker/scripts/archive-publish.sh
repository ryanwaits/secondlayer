#!/usr/bin/env bash
# Canonical archive publish cycle: export → upload → promote → status.
#
# The archive is only useful if it keeps moving. Published once, it falls
# ~5,400 blocks behind per day and `status.json` — the freshness signal — goes
# stale itself, because nothing regenerates it. This is what turns "we
# published an archive" into "we operate one".
#
# Each step gates the next. A failed export must never reach promotion, and
# promotion has its own refusal gates (signature, coverage contiguity, object
# presence, no regression) that this script deliberately does not bypass.
#
# Cadence note: partitions are 50k blocks and the chain produces ~5,400/day, so
# a new COMPLETE partition lands roughly every 9 days. Running weekly means most
# cycles re-export the same content and promote the same digest — which is
# harmless and idempotent (the uploader skips unchanged objects, promotion sees
# no regression). The status refresh is the part that matters every time.
#
# Requires SLACK_WEBHOOK_URL via the systemd unit's EnvironmentFile.
set -uo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/secondlayer/docker}"
INDEXER_CONTAINER="${INDEXER_CONTAINER:-secondlayer-indexer-1}"
STAGING_DIR="${ARCHIVE_STAGING_DIR:-/data/archive/canonical-v1-staging}"
# The export reads ~240M rows; the cap is generous but bounded so a wedged run
# cannot hold the weekly timer open forever.
EXPORT_TIMEOUT="${ARCHIVE_EXPORT_TIMEOUT:-21600}"
UPLOAD_TIMEOUT="${ARCHIVE_UPLOAD_TIMEOUT:-7200}"
STATE_FILE="${ARCHIVE_PUBLISH_STATE_FILE:-/var/run/secondlayer-archive-publish.state}"
WEBHOOK="${SLACK_WEBHOOK_URL:-}"

post_slack() {
  [ -n "$WEBHOOK" ] || return 0
  local text="$1"
  local payload
  payload=$(python3 -c "import json,sys; print(json.dumps({'text': sys.argv[1]}))" "$text" 2>/dev/null \
    || echo "{\"text\":\"secondlayer archive publish alert\"}")
  curl -s -X POST -H 'Content-Type: application/json' -d "$payload" "$WEBHOOK" >/dev/null || true
}

fail() {
  local stage="$1" detail="$2"
  echo "$(date -u +%FT%TZ) archive-publish FAILED at ${stage}: ${detail}"
  # One page per incident: a broken publish cycle is a standing condition until
  # someone fixes it, not a new surprise every week.
  if [ ! -f "$STATE_FILE" ]; then
    touch "$STATE_FILE" 2>/dev/null || true
    post_slack "🔴 secondlayer archive publish failed at ${stage}: ${detail}"
  fi
  exit 1
}

in_container() {
  docker exec "$INDEXER_CONTAINER" bun run "$@"
}

if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$INDEXER_CONTAINER"; then
  fail "startup" "indexer container '$INDEXER_CONTAINER' is not running"
fi

echo "$(date -u +%FT%TZ) archive-publish starting"

# ── 1. Export ───────────────────────────────────────────────────────────────
# `--to-block auto` bounds at the burn-confirmation finality boundary, so this
# never publishes a height that could still reorg.
export_out=$(timeout "$EXPORT_TIMEOUT" docker exec "$INDEXER_CONTAINER" \
  bun run packages/indexer/src/archive/export-snapshot.ts \
  --to-block auto --out "$STAGING_DIR" 2>&1)
export_status=$?
echo "$export_out"
[ "$export_status" -eq 0 ] || fail "export" "exit $export_status"

MANIFEST=$(printf '%s' "$export_out" | grep -o '"manifest_path": *"[^"]*"' | sed 's/.*: *"//;s/"//')
[ -n "$MANIFEST" ] || fail "export" "could not determine manifest path from output"
echo "manifest: $MANIFEST"

# ── 2. Upload ───────────────────────────────────────────────────────────────
# Resumable and idempotent: unchanged objects are skipped by size check, so a
# cycle that produces no new partitions transfers nothing.
upload_out=$(timeout "$UPLOAD_TIMEOUT" docker exec "$INDEXER_CONTAINER" \
  bun run packages/indexer/src/archive/upload-snapshot.ts \
  --manifest "$MANIFEST" 2>&1)
upload_status=$?
echo "$upload_out"
[ "$upload_status" -eq 0 ] || fail "upload" "exit $upload_status"

# ── 3. Promote ──────────────────────────────────────────────────────────────
# Refuses on bad signature, non-contiguous coverage, a missing or wrong-sized
# object, or a regression to an older tip. Those gates are the point.
promote_out=$(docker exec "$INDEXER_CONTAINER" \
  bun run packages/indexer/src/archive/promote-snapshot.ts \
  --manifest "$MANIFEST" --apply 2>&1)
promote_status=$?
echo "$promote_out"
[ "$promote_status" -eq 0 ] || fail "promote" "$(printf '%s' "$promote_out" | grep -E '^FAIL' | head -3 | tr '\n' ' ')"

# ── 4. Status ───────────────────────────────────────────────────────────────
status_out=$(docker exec "$INDEXER_CONTAINER" \
  bun run packages/indexer/src/archive/publish-status.ts --apply 2>&1)
status_status=$?
echo "$status_out"
[ "$status_status" -eq 0 ] || fail "status" "exit $status_status"

STATE=$(printf '%s' "$status_out" | grep -o '"state": *"[^"]*"' | sed 's/.*: *"//;s/"//')
COVERAGE=$(printf '%s' "$status_out" | grep -o '"coverage_to_block": *[0-9]*' | grep -o '[0-9]*')

echo "$(date -u +%FT%TZ) archive-publish OK (state=${STATE}, through ${COVERAGE})"

# Recovery all-clear, once.
if [ -f "$STATE_FILE" ]; then
  rm -f "$STATE_FILE"
  post_slack "✅ secondlayer archive publish recovered — published through ${COVERAGE} (${STATE})"
fi

# A cycle that succeeds but leaves the archive unhealthy is worth saying out
# loud: promotion passed its gates, yet the archive is not in a restorable
# state.
case "$STATE" in
  fresh|lagging) ;;
  *) post_slack "⚠️ secondlayer archive published but status is ${STATE} (through ${COVERAGE})" ;;
esac

exit 0
