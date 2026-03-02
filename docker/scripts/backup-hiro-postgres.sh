#!/usr/bin/env bash
# Hiro Postgres backup via pg_dump
# Usage: backup-hiro-postgres.sh
# Cron: 0 3 * * * /opt/secondlayer/docker/scripts/backup-hiro-postgres.sh >> /var/log/backup-hiro-postgres.log 2>&1
set -euo pipefail

DATA_DIR="${DATA_DIR:-/opt/secondlayer/data}"
BACKUP_DIR="${DATA_DIR}/backups/hiro-postgres"
CONTAINER="${HIRO_PG_CONTAINER:-secondlayer-hiro-postgres-1}"
PG_USER="${HIRO_PG_USER:-postgres}"
PG_DB="${HIRO_PG_DB:-stacks_blockchain_api}"
RETENTION_DAYS=3
DATE=$(date +%Y%m%d-%H%M%S)

log() { echo "[$(date -Iseconds)] $*"; }

mkdir -p "$BACKUP_DIR"

BACKUP_FILE="${BACKUP_DIR}/hiro-postgres-${DATE}.sql.gz"
log "Starting pg_dump from container ${CONTAINER}"

docker exec "$CONTAINER" pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$BACKUP_FILE"

log "Backup complete: ${BACKUP_FILE}"
ls -lh "$BACKUP_FILE"

# Retention: delete backups older than $RETENTION_DAYS days
find "$BACKUP_DIR" -name "hiro-postgres-*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
log "Retention applied (keeping last ${RETENTION_DAYS} days)"
