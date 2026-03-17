#!/usr/bin/env bash
# Restore postgres from Storage Box snapshot
# Usage: restore-from-snapshot.sh [--hiro] [--date YYYYMMDD] [--verify-only] [--dry-run]
# Example: restore-from-snapshot.sh --hiro --date 20260301 --verify-only
set -euo pipefail

DATA_DIR="${DATA_DIR:-/opt/secondlayer/data}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/secondlayer/docker}"
COMPOSE="docker compose -f ${COMPOSE_DIR}/docker-compose.yml -f ${COMPOSE_DIR}/docker-compose.hetzner.yml"

STORAGEBOX_USER="${STORAGEBOX_USER:?STORAGEBOX_USER required}"
STORAGEBOX_HOST="${STORAGEBOX_HOST:?STORAGEBOX_HOST required}"
STORAGEBOX_PATH="${STORAGEBOX_PATH:-backups}"
STORAGEBOX_PORT="${STORAGEBOX_PORT:-23}"

# Defaults
HIRO=false
DATE=""
VERIFY_ONLY=false
DRY_RUN=false

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --hiro) HIRO=true; shift ;;
    --date) DATE="$2"; shift 2 ;;
    --verify-only) VERIFY_ONLY=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

log() { echo "[$(date -Iseconds)] $*"; }

# Set vars based on --hiro flag
if [ "$HIRO" = true ]; then
  BACKUP_SUBDIR="hiro-postgres"
  BACKUP_PREFIX="hiro-postgres"
  PG_CONTAINER="${HIRO_PG_CONTAINER:-secondlayer-hiro-postgres-1}"
  PG_USER="${HIRO_PG_USER:-postgres}"
  PG_DB="${HIRO_PG_DB:-stacks_blockchain_api}"
  DEPENDENTS="hiro-api"
else
  BACKUP_SUBDIR="postgres"
  BACKUP_PREFIX="postgres"
  PG_CONTAINER="${PG_CONTAINER:-secondlayer-postgres-1}"
  PG_USER="${PG_USER:-secondlayer}"
  PG_DB="${PG_DB:-secondlayer}"
  DEPENDENTS="api indexer worker subgraph-processor"
fi

LOCAL_BACKUP_DIR="${DATA_DIR}/backups/${BACKUP_SUBDIR}"

# --- Verify function ---
verify_db() {
  log "Verifying database integrity..."
  local block_count tip missing

  if [ "$HIRO" = true ]; then
    block_count=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT count(*) FROM blocks;" 2>/dev/null | tr -d ' ')
    tip=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT max(block_height) FROM blocks;" 2>/dev/null | tr -d ' ')
    missing=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT (max(block_height) - min(block_height) + 1) - count(*) FROM blocks WHERE canonical = true;" 2>/dev/null | tr -d ' ')
  else
    block_count=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT count(*) FROM blocks;" 2>/dev/null | tr -d ' ')
    tip=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT max(height) FROM blocks;" 2>/dev/null | tr -d ' ')
    missing=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -c "SELECT (max(height) - min(height) + 1) - count(*) FROM blocks WHERE canonical = true;" 2>/dev/null | tr -d ' ')
  fi

  log "Block count: ${block_count:-unknown}"
  log "Chain tip:   ${tip:-unknown}"
  log "Gaps:        ${missing:-unknown}"

  if [ "${missing:-1}" -gt 0 ] 2>/dev/null; then
    log "WARNING: ${missing} gaps detected"
    return 1
  fi
  log "Verification passed"
  return 0
}

# --- Verify-only mode ---
if [ "$VERIFY_ONLY" = true ]; then
  verify_db
  exit $?
fi

# --- Find backup file ---
SSH_CMD="ssh -p ${STORAGEBOX_PORT} ${STORAGEBOX_USER}@${STORAGEBOX_HOST}"

if [ -n "$DATE" ]; then
  REMOTE_FILE=$($SSH_CMD "ls -1 ${STORAGEBOX_PATH}/${BACKUP_SUBDIR}/${BACKUP_PREFIX}-${DATE}*.sql.gz 2>/dev/null | tail -1")
else
  REMOTE_FILE=$($SSH_CMD "ls -1t ${STORAGEBOX_PATH}/${BACKUP_SUBDIR}/${BACKUP_PREFIX}-*.sql.gz 2>/dev/null | head -1")
fi

if [ -z "$REMOTE_FILE" ]; then
  log "ERROR: no backup found on Storage Box"
  exit 1
fi

log "Selected backup: $REMOTE_FILE"

# --- Dry-run mode ---
if [ "$DRY_RUN" = true ]; then
  log "DRY RUN — would perform:"
  log "  1. Download: scp ${REMOTE_FILE}"
  log "  2. Stop dependents: ${DEPENDENTS}"
  log "  3. Drop + recreate db: ${PG_DB}"
  log "  4. Restore from backup"
  log "  5. Run migrations"
  log "  6. Verify (block count + gaps)"
  log "  7. Restart dependents"
  exit 0
fi

# --- Download ---
mkdir -p "$LOCAL_BACKUP_DIR"
LOCAL_FILE="${LOCAL_BACKUP_DIR}/$(basename "$REMOTE_FILE")"

log "Downloading backup..."
scp -P "$STORAGEBOX_PORT" "${STORAGEBOX_USER}@${STORAGEBOX_HOST}:${REMOTE_FILE}" "$LOCAL_FILE"

# --- Stop dependents ---
log "Stopping dependent services: ${DEPENDENTS}"
for svc in $DEPENDENTS; do
  $COMPOSE stop "$svc" || true
done

# --- Drop + recreate ---
log "Dropping and recreating database: ${PG_DB}"
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -c "DROP DATABASE IF EXISTS ${PG_DB};"
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -c "CREATE DATABASE ${PG_DB} OWNER ${PG_USER};"

# --- Restore ---
log "Restoring from: ${LOCAL_FILE}"
gunzip -c "$LOCAL_FILE" | docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB"

# --- Migrations (secondlayer only) ---
if [ "$HIRO" = false ]; then
  log "Running migrations..."
  $COMPOSE run --rm migrate
fi

# --- Verify ---
verify_db || log "WARNING: verification found issues — check manually"

# --- Restart dependents ---
log "Restarting dependent services..."
for svc in $DEPENDENTS; do
  $COMPOSE start "$svc"
done

log "Restore complete"
