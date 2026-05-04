#!/bin/bash
# Sync WAL archive to Hetzner Storage Box
# Cron: */5 * * * * /opt/secondlayer/docker/scripts/sync-wal.sh
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/secondlayer/docker/.env}"
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ""|\#*) continue ;;
      *=*) ;;
      *) continue ;;
    esac

    key="${line%%=*}"
    value="${line#*=}"
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi
    if [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    printf -v "$key" '%s' "$value"
    export "$key"
  done < "$ENV_FILE"
fi

DATA_DIR="${DATA_DIR:-/opt/secondlayer/data}"
WAL_DIR="${DATA_DIR}/wal_archive"
STORAGEBOX_USER="${STORAGEBOX_USER:?required}"
STORAGEBOX_HOST="${STORAGEBOX_HOST:?required}"
STORAGEBOX_PATH="${STORAGEBOX_PATH:-backups}"
STORAGEBOX_PORT="${STORAGEBOX_PORT:-23}"

[ ! -d "$WAL_DIR" ] && exit 0

# Count files to sync
FILE_COUNT=$(find "$WAL_DIR" -maxdepth 1 -name '0*' -type f 2>/dev/null | wc -l)
[ "$FILE_COUNT" -eq 0 ] && exit 0

rsync -az \
  -e "ssh -p ${STORAGEBOX_PORT} -o StrictHostKeyChecking=accept-new" \
  "${WAL_DIR}/" \
  "${STORAGEBOX_USER}@${STORAGEBOX_HOST}:${STORAGEBOX_PATH}/wal/"

# Remove WAL files older than 24h that have been synced
find "$WAL_DIR" -maxdepth 1 -name '0*' -type f -mmin +1440 -delete

echo "[$(date -Iseconds)] Synced ${FILE_COUNT} WAL files"
