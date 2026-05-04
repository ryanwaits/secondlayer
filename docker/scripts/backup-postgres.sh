#!/bin/bash
# Postgres backup via pg_dump
# Usage: backup-postgres.sh
# Cron: 0 3 * * * /opt/secondlayer/docker/scripts/backup-postgres.sh
set -euo pipefail

DATA_DIR="${DATA_DIR:-/opt/secondlayer/data}"
BACKUP_DIR="${DATA_DIR}/backups/postgres"
LOCK_FILE="${DB_MAINTENANCE_LOCK_FILE:-${DATA_DIR}/db-maintenance.lock}"
CONTAINER="${PG_CONTAINER:-secondlayer-postgres-1}"
PG_USER="${PG_USER:-secondlayer}"
PG_DB="${PG_DB:-secondlayer}"
RETENTION_DAYS="${PG_BACKUP_RETENTION_DAYS:-7}"
DATE=$(date +%Y%m%d-%H%M%S)

log() { echo "[$(date -Iseconds)] $*"; }

mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOCK_FILE")"

BACKUP_FILE="${BACKUP_DIR}/postgres-${DATE}.sql.gz"
TEMP_FILE="${BACKUP_FILE}.tmp"
cleanup() {
  rm -f "$TEMP_FILE"
}
trap cleanup EXIT

exec 9>"$LOCK_FILE"
log "Waiting for DB maintenance lock ${LOCK_FILE}"
flock 9

log "Starting pg_dump from container ${CONTAINER}"

docker exec "$CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$TEMP_FILE"
gzip -t "$TEMP_FILE"
mv "$TEMP_FILE" "$BACKUP_FILE"
trap - EXIT

log "Backup complete: ${BACKUP_FILE}"
ls -lh "$BACKUP_FILE"

# Retention: delete backups older than $RETENTION_DAYS days
find "$BACKUP_DIR" -name "postgres-*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
log "Retention applied (keeping last ${RETENTION_DAYS} days)"
