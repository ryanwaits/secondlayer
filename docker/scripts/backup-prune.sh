#!/bin/bash
# Retention for per-tenant Postgres backups written by backup-tenant-pg.sh.
#
# Layout:
#   $DATA_DIR/backups/tenants/<slug>/YYYY-MM-DDTHH-MM-SSZ.dump
#
# Policy:
#   - Hourly dumps kept for 7 days (HOURLY_KEEP_DAYS).
#   - First dump of each day kept for 30 days (DAILY_KEEP_DAYS).
#   - Anything older than DAILY_KEEP_DAYS is removed.
#
# Usage: backup-prune.sh
# Cron:  5 * * * * /opt/secondlayer/docker/scripts/backup-prune.sh >> /var/log/backup-prune.log 2>&1

set -euo pipefail

DATA_DIR="${DATA_DIR:-/opt/secondlayer/data}"
BACKUP_ROOT="${DATA_DIR}/backups/tenants"
HOURLY_KEEP_DAYS="${HOURLY_KEEP_DAYS:-7}"
DAILY_KEEP_DAYS="${DAILY_KEEP_DAYS:-30}"

log() { echo "[$(date -Iseconds)] $*"; }

if [ ! -d "$BACKUP_ROOT" ]; then
  log "No backup root at $BACKUP_ROOT — nothing to prune"
  exit 0
fi

# Thresholds (epoch seconds). File mtime older than these → candidate for deletion.
now_epoch=$(date -u +%s)
hourly_cutoff=$(( now_epoch - HOURLY_KEEP_DAYS * 86400 ))
daily_cutoff=$(( now_epoch - DAILY_KEEP_DAYS * 86400 ))

PRUNED=0
KEPT=0

shopt -s nullglob
for tenant_dir in "$BACKUP_ROOT"/*/; do
  slug=$(basename "$tenant_dir")

  # Sort ascending so the first file per day is the earliest timestamp → our daily-keeper.
  mapfile -t dumps < <(ls -1 "$tenant_dir"/*.dump 2>/dev/null | sort)
  [ "${#dumps[@]}" -eq 0 ] && continue

  # Track which dates already have their daily-keeper selected.
  declare -A daily_kept=()

  for f in "${dumps[@]}"; do
    fname=$(basename "$f")
    # Date portion is the first 10 chars of the filename: YYYY-MM-DD.
    day="${fname:0:10}"
    mtime=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")

    if [ "$mtime" -lt "$daily_cutoff" ]; then
      # Past the 30d daily window — drop unconditionally.
      rm -f "$f"
      PRUNED=$((PRUNED + 1))
      log "  ✗ $slug/$fname (age > ${DAILY_KEEP_DAYS}d)"
      continue
    fi

    if [ "$mtime" -lt "$hourly_cutoff" ]; then
      # Between 7d and 30d: keep only the first dump of each day.
      if [ -z "${daily_kept[$day]:-}" ]; then
        daily_kept[$day]=1
        KEPT=$((KEPT + 1))
      else
        rm -f "$f"
        PRUNED=$((PRUNED + 1))
        log "  ✗ $slug/$fname (hourly, age > ${HOURLY_KEEP_DAYS}d, daily-of-day already kept)"
      fi
      continue
    fi

    # Within the 7d hourly window — keep everything.
    KEPT=$((KEPT + 1))
    daily_kept[$day]=1
  done

  unset daily_kept
done

log "Prune complete: $PRUNED removed, $KEPT retained"
