#!/bin/bash
# Upload local backups to Hetzner Storage Box via rsync/SSH
# Usage: upload-snapshot.sh [--dry-run]
# Cron: 0 5 * * * /opt/secondlayer/docker/scripts/upload-snapshot.sh >> /var/log/upload-snapshot.log 2>&1
set -euo pipefail

# Source env vars when running from cron
ENV_FILE="${ENV_FILE:-/opt/secondlayer/docker/.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

DATA_DIR="${DATA_DIR:-/opt/secondlayer/data}"
BACKUP_DIR="${DATA_DIR}/backups"

STORAGEBOX_USER="${STORAGEBOX_USER:?STORAGEBOX_USER required}"
STORAGEBOX_HOST="${STORAGEBOX_HOST:?STORAGEBOX_HOST required}"
STORAGEBOX_PATH="${STORAGEBOX_PATH:-backups}"
STORAGEBOX_PORT="${STORAGEBOX_PORT:-23}"

DRY_RUN=""
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN="--dry-run"

log() { echo "[$(date -Iseconds)] $*"; }

if [ ! -d "$BACKUP_DIR" ]; then
  log "ERROR: backup dir not found: $BACKUP_DIR"
  exit 1
fi

RSYNC_OPTS=(
  -avz
  --progress
  -e "ssh -p ${STORAGEBOX_PORT} -o StrictHostKeyChecking=accept-new"
  --delete
  $DRY_RUN
)

log "Uploading backups to ${STORAGEBOX_USER}@${STORAGEBOX_HOST}:${STORAGEBOX_PATH}"
[[ -n "$DRY_RUN" ]] && log "DRY RUN — no files will be transferred"

# Upload postgres backups
if [ -d "${BACKUP_DIR}/postgres" ]; then
  log "Syncing postgres backups..."
  rsync "${RSYNC_OPTS[@]}" "${BACKUP_DIR}/postgres/" "${STORAGEBOX_USER}@${STORAGEBOX_HOST}:${STORAGEBOX_PATH}/postgres/"
fi

# Upload hiro-postgres backups
if [ -d "${BACKUP_DIR}/hiro-postgres" ]; then
  log "Syncing hiro-postgres backups..."
  rsync "${RSYNC_OPTS[@]}" "${BACKUP_DIR}/hiro-postgres/" "${STORAGEBOX_USER}@${STORAGEBOX_HOST}:${STORAGEBOX_PATH}/hiro-postgres/"
fi

# Upload chainstate backups
if [ -d "${BACKUP_DIR}/chainstate" ]; then
  log "Syncing chainstate backups..."
  rsync "${RSYNC_OPTS[@]}" "${BACKUP_DIR}/chainstate/" "${STORAGEBOX_USER}@${STORAGEBOX_HOST}:${STORAGEBOX_PATH}/chainstate/"
fi

log "Upload complete"
