#!/bin/bash
# Weekly pg_basebackup for WAL-based PITR restore
# Cron: 0 4 * * 0 /opt/secondlayer/docker/scripts/backup-basebackup.sh
set -euo pipefail

DATA_DIR="${DATA_DIR:-/opt/secondlayer/data}"
BACKUP_DIR="${DATA_DIR}/backups/basebackup"
CONTAINER="${PG_CONTAINER:-secondlayer-postgres-1}"
PG_USER="${PG_USER:-secondlayer}"
RETENTION_DAYS=14
DATE=$(date +%Y%m%d-%H%M%S)

log() { echo "[$(date -Iseconds)] $*"; }

mkdir -p "$BACKUP_DIR"

BACKUP_FILE="${BACKUP_DIR}/basebackup-${DATE}.tar.gz"
log "Starting pg_basebackup from container ${CONTAINER}"

# `-X stream` ships WAL files alongside the base backup (in pg_wal.tar.gz),
# making the resulting archive self-contained — restore needs only the
# basebackup itself, not a separately-archived WAL stream. Without this,
# `archive_mode=on` + `archive_command` is required for a recoverable
# backup; both are commented out in `docker-compose.hetzner.yml`, so a
# restore from `-Xnone` archives will fail with "WAL files missing".
#
# `--checkpoint=fast` skips waiting for the next regular checkpoint
# (which can be 5+ minutes); we want backups to start immediately.
docker exec "$CONTAINER" pg_basebackup \
  -U "$PG_USER" \
  -Ft -z \
  -X stream \
  --checkpoint=fast \
  -D /tmp/basebackup 2>"${BACKUP_DIR}/.last-error"

if [ ! -f "/tmp/basebackup/base.tar.gz" ] && \
   ! docker exec "$CONTAINER" test -f /tmp/basebackup/base.tar.gz; then
  log "✗ pg_basebackup failed — see ${BACKUP_DIR}/.last-error"
  exit 1
fi

docker cp "${CONTAINER}:/tmp/basebackup/base.tar.gz" "$BACKUP_FILE"
# `-X stream` produces a sibling `pg_wal.tar.gz`; copy it too.
docker cp "${CONTAINER}:/tmp/basebackup/pg_wal.tar.gz" "${BACKUP_DIR}/basebackup-${DATE}-wal.tar.gz" 2>/dev/null || true
docker exec "$CONTAINER" rm -rf /tmp/basebackup

# Verify the gzip is well-formed before we trust it for retention pruning.
if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
  log "✗ Backup archive failed gzip verification — keeping prior backups intact"
  rm -f "$BACKUP_FILE"
  exit 1
fi

log "Backup complete: ${BACKUP_FILE}"
ls -lh "$BACKUP_FILE"

find "$BACKUP_DIR" -name "basebackup-*.tar.gz" -mtime +"$RETENTION_DAYS" -delete
log "Retention applied (keeping last ${RETENTION_DAYS} days)"
