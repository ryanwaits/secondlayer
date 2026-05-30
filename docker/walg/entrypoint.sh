#!/usr/bin/env bash
# WAL-G backup sidecar entrypoint.
#
# Two concurrent loops:
#   1. WAL spooler — pushes each completed segment the postgres `archive_command`
#      dropped in /wal_archive up to R2, then deletes it (this also bounds the
#      otherwise-unbounded local /wal_archive).
#   2. Base backup — takes a `wal-g backup-push` on an interval (default weekly)
#      and prunes to the last N fulls. A base + its WAL = point-in-time recovery.
set -euo pipefail

: "${WALG_S3_PREFIX:?set WALG_S3_PREFIX (e.g. s3://secondlayer-db-backups/pg)}"
: "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}" "${AWS_ENDPOINT:?}"

export PGHOST="${PGHOST:-postgres}"
export PGPORT="${PGPORT:-5432}"
WAL_DIR="${WAL_DIR:-/wal_archive}"
PGDATA="${PGDATA:-/pgdata}"
BACKUP_INTERVAL_SECS="${BACKUP_INTERVAL_SECS:-604800}" # 7 days
RETAIN_FULL="${RETAIN_FULL:-4}"
WAL_SEGMENT_BYTES="${WAL_SEGMENT_BYTES:-16777216}"     # 16 MiB
STABLE_AGE_SECS="${STABLE_AGE_SECS:-5}"

log() { echo "[walg $(date -u +%FT%TZ)] $*"; }

log "waiting for postgres at ${PGHOST}:${PGPORT}…"
until pg_isready -q; do sleep 2; done
log "postgres reachable; prefix=${WALG_S3_PREFIX}"

# Push one WAL file, delete on success. Skip in-flight writes: 16 MiB segments
# must be exactly full and stable; .history/.backup files just need to be stable.
push_wal_file() {
  local f="$1" name age size
  name="$(basename "$f")"
  age=$(( $(date +%s) - $(stat -c %Y "$f") ))
  [ "$age" -ge "$STABLE_AGE_SECS" ] || return 0
  if [[ "$name" =~ ^[0-9A-F]{24}$ ]]; then
    size=$(stat -c %s "$f")
    [ "$size" -eq "$WAL_SEGMENT_BYTES" ] || return 0
  fi
  if wal-g wal-push "$f" >/dev/null 2>&1; then
    rm -f "$f"
  else
    log "wal-push failed for ${name} (will retry)"
  fi
}

wal_spooler() {
  while true; do
    shopt -s nullglob
    for f in "$WAL_DIR"/[0-9A-F]*; do
      [ -f "$f" ] && push_wal_file "$f"
    done
    shopt -u nullglob
    sleep 15
  done
}

backup_loop() {
  local last=0 now
  while true; do
    now=$(date +%s)
    if [ $(( now - last )) -ge "$BACKUP_INTERVAL_SECS" ]; then
      log "starting base backup-push…"
      if wal-g backup-push "$PGDATA"; then
        log "base backup complete; pruning to last ${RETAIN_FULL} fulls"
        wal-g delete retain FULL "$RETAIN_FULL" --confirm || log "retention prune failed"
        last=$now
      else
        log "backup-push failed; will retry next cycle"
      fi
    fi
    sleep 3600
  done
}

wal_spooler &
backup_loop &
wait
