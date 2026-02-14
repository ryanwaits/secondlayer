#!/usr/bin/env bash
# LVM snapshot-based chainstate backup
# Usage: backup-chainstate.sh
# Cron: 0 4 * * * /opt/secondlayer/docker/scripts/backup-chainstate.sh
set -euo pipefail

DATA_DIR="${DATA_DIR:-/opt/secondlayer/data}"
BACKUP_DIR="${DATA_DIR}/backups/chainstate"
VG_NAME="${VG_NAME:-vg0}"
LV_NAME="${LV_NAME:-chainstate}"
SNAP_SIZE="${SNAP_SIZE:-50G}"
RETENTION_DAYS=3
DATE=$(date +%Y%m%d-%H%M%S)
SNAP_NAME="${LV_NAME}-snap-${DATE}"

log() { echo "[$(date -Iseconds)] $*"; }

mkdir -p "$BACKUP_DIR"

# Create LVM snapshot (near-instant, no downtime)
log "Creating LVM snapshot ${SNAP_NAME}"
lvcreate -L "$SNAP_SIZE" -s -n "$SNAP_NAME" "/dev/${VG_NAME}/${LV_NAME}"

# Mount snapshot read-only
SNAP_MOUNT=$(mktemp -d)
mount -o ro "/dev/${VG_NAME}/${SNAP_NAME}" "$SNAP_MOUNT"

# Tar + compress
BACKUP_FILE="${BACKUP_DIR}/chainstate-${DATE}.tar.zst"
log "Compressing to ${BACKUP_FILE}"
tar -C "$SNAP_MOUNT" -cf - . | zstd -T0 -3 > "$BACKUP_FILE"

# Cleanup snapshot
umount "$SNAP_MOUNT"
rmdir "$SNAP_MOUNT"
lvremove -f "/dev/${VG_NAME}/${SNAP_NAME}"
log "Snapshot removed"

# Retention: delete backups older than $RETENTION_DAYS days
find "$BACKUP_DIR" -name "chainstate-*.tar.zst" -mtime +"$RETENTION_DAYS" -delete
log "Retention applied (keeping last ${RETENTION_DAYS} days)"

log "Chainstate backup complete: ${BACKUP_FILE}"
ls -lh "$BACKUP_FILE"
