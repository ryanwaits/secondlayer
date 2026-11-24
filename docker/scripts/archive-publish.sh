#!/usr/bin/env bash
# Canonical archive publish cycle: export → upload → promote → status.
#
# The archive is only useful if it keeps moving. Published once, it falls
# ~7-9k blocks behind per day and `status.json` — the freshness signal — goes
# stale itself, because nothing regenerates it. This is what turns "we
# published an archive" into "we operate one".
#
# Each step gates the next. A failed export must never reach promotion, and
# promotion has its own refusal gates (signature, coverage contiguity, object
# presence, no regression) that this script deliberately does not bypass.
#
# Cadence note: partitions are 50k blocks and the chain produces ~7-9k/day, so
# a new COMPLETE partition lands roughly every 6 days. Running twice weekly
# (Wed + Sun) means some cycles re-export the same content and promote the same
# digest — which is harmless and idempotent (the uploader skips unchanged
# objects, promotion sees no regression). Promoting on that cadence is what
# keeps the freshness clock inside its objective; the cheaper hourly status
# refresh reports the clock but cannot advance it.
#
# Requires SLACK_WEBHOOK_URL via the systemd unit's EnvironmentFile.
set -uo pipefail

# shellcheck source=lib/post-slack.sh
. "$(dirname "$0")/lib/post-slack.sh"

COMPOSE_DIR="${COMPOSE_DIR:-/opt/secondlayer/docker/prod}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"
cd "$COMPOSE_DIR" || { echo "archive-publish: cannot cd to $COMPOSE_DIR"; exit 1; }
# Container-side path passed to the exporter.
STAGING_DIR="${ARCHIVE_STAGING_DIR:-/data/archive/canonical-v1-staging}"
# Host-side path for the same directory, resolved through the compose bind
# mount. The wrapper needs this because the attached stream (an exec into the
# indexer then, `compose run` now) can fail to close after the child process exits
# (2026-08-13 incident: export finished in 3.3 h, the exec stream stayed open,
# outer `timeout` killed it at the 6 h mark, wrapper flagged the whole cycle
# as failed even though a valid signed snapshot was on disk). Confirmed
# 2026-09-28: not dockerd — the script itself hung in `await closeDb()` after
# printing its summary, 0% CPU, one open socket, `wchan=ep_poll`; only the
# outer `timeout` moved things along. `export-snapshot.ts` now bounds that
# shutdown itself, but reading the manifest from the shared bind mount stays
# the recovery path for whatever hangs next.
HOST_STAGING_DIR="${ARCHIVE_HOST_STAGING_DIR:-/opt/secondlayer/data/archive/canonical-v1-staging}"
# The export reads ~320M rows over the network from the chain DB host; the
# 2026-11-23 run reached 190/192 chunks at 6 h. The cap is generous but bounded
# so a wedged run cannot hold the weekly timer open forever.
EXPORT_TIMEOUT="${ARCHIVE_EXPORT_TIMEOUT:-43200}"
UPLOAD_TIMEOUT="${ARCHIVE_UPLOAD_TIMEOUT:-7200}"
STATE_FILE="${ARCHIVE_PUBLISH_STATE_FILE:-/var/run/secondlayer-archive-publish.state}"

fail() {
  local stage="$1" detail="$2"
  echo "$(date -u +%FT%TZ) archive-publish FAILED at ${stage}: ${detail}"
  # One page per incident: a broken publish cycle is a standing condition until
  # someone fixes it, not a new surprise every week.
  if [ ! -f "$STATE_FILE" ]; then
    touch "$STATE_FILE" 2>/dev/null || true
    post_slack "🔴 secondlayer archive publish failed at ${stage}: ${detail}" --force
  fi
  exit 1
}

# Each stage runs in its own `archive-job` one-off (indexer image and env,
# profile `jobs`), so a deploy that recreates the indexer can't kill it.
# A plain word list, not a function: `timeout` needs an executable.
JOB="$COMPOSE --profile jobs run --rm --no-deps -T archive-job bun run"

# A one-off left behind by a crashed or timed-out run.
remove_stale_jobs() {
  docker ps -aq --filter label=com.docker.compose.service=archive-job \
    | xargs -r docker rm -f >/dev/null 2>&1 || true
}

echo "$(date -u +%FT%TZ) archive-publish starting"
remove_stale_jobs

# ── 1. Export ───────────────────────────────────────────────────────────────
# `--to-block auto` bounds at the burn-confirmation finality boundary, so this
# never publishes a height that could still reorg.
#
# Recovery guard for the attached-stream hang: we snapshot the newest manifest
# file in the shared bind mount before starting, so after the exec returns
# (cleanly, timed out, or anything else) we can ask a simpler question — did
# a NEW signed snapshot land on disk? If yes, the export succeeded, whatever
# the exec stream did or didn't do. If no, it really failed.
SNAPSHOTS_HOST_DIR="$HOST_STAGING_DIR/snapshots"
mkdir -p "$SNAPSHOTS_HOST_DIR" 2>/dev/null || true
# Newest manifest by mtime BEFORE the run, or empty if none.
pre_manifest=$(find "$SNAPSHOTS_HOST_DIR" -maxdepth 1 -name '*.json' -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn | head -n1 | awk '{print $2}')

export_out=$(timeout "$EXPORT_TIMEOUT" $JOB \
  packages/indexer/src/archive/export-snapshot.ts \
  --to-block auto --out "$STAGING_DIR" 2>&1)
export_status=$?
echo "$export_out"
# `timeout` kills the compose client, not necessarily the container.
[ "$export_status" -eq 0 ] || remove_stale_jobs

# Preferred path: parse the summary JSON the CLI printed. This works whenever
# the attached stream behaved normally.
MANIFEST=$(printf '%s' "$export_out" | grep -o '"manifest_path": *"[^"]*"' | sed 's/.*: *"//;s/"//')

# Recovery path: if the job exited nonzero (typically 124 from `timeout`)
# but a new manifest file exists on disk, trust the file. The manifest is
# self-signed and digest-addressed, so a corrupt or partial write cannot
# masquerade as a valid one; downstream promotion will still catch it.
if [ -z "$MANIFEST" ] || [ "$export_status" -ne 0 ]; then
  post_manifest=$(find "$SNAPSHOTS_HOST_DIR" -maxdepth 1 -name '*.json' -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | head -n1 | awk '{print $2}')
  if [ -n "$post_manifest" ] && [ "$post_manifest" != "$pre_manifest" ]; then
    # Container path is the same file via the bind mount.
    container_path="$STAGING_DIR/snapshots/$(basename "$post_manifest")"
    echo "$(date -u +%FT%TZ) export-recovery: export job returned $export_status but a new manifest is on disk ($container_path); continuing"
    MANIFEST="$container_path"
    export_status=0
  fi
fi

[ "$export_status" -eq 0 ] || fail "export" "exit $export_status"
[ -n "$MANIFEST" ] || fail "export" "could not determine manifest path from output or disk"
echo "manifest: $MANIFEST"

# ── 2. Upload ───────────────────────────────────────────────────────────────
# Resumable and idempotent: unchanged objects are skipped by size check, so a
# cycle that produces no new partitions transfers nothing.
upload_out=$(timeout "$UPLOAD_TIMEOUT" $JOB \
  packages/indexer/src/archive/upload-snapshot.ts \
  --manifest "$MANIFEST" 2>&1)
upload_status=$?
echo "$upload_out"
[ "$upload_status" -eq 0 ] || remove_stale_jobs
[ "$upload_status" -eq 0 ] || fail "upload" "exit $upload_status"

# ── 3. Promote ──────────────────────────────────────────────────────────────
# Refuses on bad signature, non-contiguous coverage, a missing or wrong-sized
# object, or a regression to an older tip. Those gates are the point.
promote_out=$($JOB \
  packages/indexer/src/archive/promote-snapshot.ts \
  --manifest "$MANIFEST" --apply 2>&1)
promote_status=$?
echo "$promote_out"
[ "$promote_status" -eq 0 ] || fail "promote" "$(printf '%s' "$promote_out" | grep -E '^FAIL' | head -3 | tr '\n' ' ')"

# ── 4. Status ───────────────────────────────────────────────────────────────
status_out=$($JOB \
  packages/indexer/src/archive/publish-status.ts --apply 2>&1)
status_status=$?
echo "$status_out"
[ "$status_status" -eq 0 ] || fail "status" "exit $status_status"

STATE=$(printf '%s' "$status_out" | grep -o '"state": *"[^"]*"' | sed 's/.*: *"//;s/"//')
COVERAGE=$(printf '%s' "$status_out" | grep -o '"coverage_to_block": *[0-9]*' | grep -o '[0-9]*')

echo "$(date -u +%FT%TZ) archive-publish OK (state=${STATE}, through ${COVERAGE})"

# Recovery all-clear, once.
if [ -f "$STATE_FILE" ]; then
  rm -f "$STATE_FILE"
  post_slack "✅ secondlayer archive publish recovered — published through ${COVERAGE} (${STATE})" --recovery
fi

# A cycle that succeeds but leaves the archive unhealthy is worth saying out
# loud: promotion passed its gates, yet the archive is not in a restorable
# state.
case "$STATE" in
  fresh|lagging) ;;
  *) post_slack "⚠️ secondlayer archive published but status is ${STATE} (through ${COVERAGE})" --force ;;
esac

exit 0
