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

docker exec "$CONTAINER" pg_basebackup \
  -U "$PG_USER" \
  -Ft -z \
  -D /tmp/basebackup 2>/dev/null

docker cp "${CONTAINER}:/tmp/basebackup/base.tar.gz" "$BACKUP_FILE"
docker exec "$CONTAINER" rm -rf /tmp/basebackup

log "Backup complete: ${BACKUP_FILE}"
ls -lh "$BACKUP_FILE"

find "$BACKUP_DIR" -name "basebackup-*.tar.gz" -mtime +"$RETENTION_DAYS" -delete
log "Retention applied (keeping last ${RETENTION_DAYS} days)"
