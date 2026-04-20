#!/bin/bash
# Per-tenant Postgres backup via pg_dump (custom format, compressed).
#
# Iterates every running sl-pg-<slug> container, dumps the tenant DB to
# $DATA_DIR/backups/tenants/<slug>/YYYY-MM-DDTHH-MM-SSZ.dump, then lets
# upload-snapshot.sh rsync the tree to the Storage Box.
#
# Usage: backup-tenant-pg.sh
# Cron:  0 * * * * /opt/secondlayer/docker/scripts/backup-tenant-pg.sh >> /var/log/backup-tenant-pg.log 2>&1
#
# Retention is handled separately by backup-prune.sh — this script only writes.

set -euo pipefail

DATA_DIR="${DATA_DIR:-/opt/secondlayer/data}"
BACKUP_ROOT="${DATA_DIR}/backups/tenants"
# pg_dump -Fc produces a compressed custom-format archive — typically ~5-10x
# smaller than plain SQL + gzip and restorable with pg_restore.
DUMP_OPTS="-Fc -Z9"
TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)

log() { echo "[$(date -Iseconds)] $*"; }

mkdir -p "$BACKUP_ROOT"

# Enumerate running tenant PG containers via the shared label.
mapfile -t CONTAINERS < <(
  docker ps --filter "label=secondlayer.role=postgres" --format "{{.Names}}" |
    grep -E '^sl-pg-' || true
)

if [ "${#CONTAINERS[@]}" -eq 0 ]; then
  log "No tenant pg containers running — nothing to back up"
  exit 0
fi

log "Backing up ${#CONTAINERS[@]} tenant database(s)"

FAILED=0
for ctr in "${CONTAINERS[@]}"; do
  # Extract slug from the container name: sl-pg-<slug>
  slug="${ctr#sl-pg-}"
  out_dir="${BACKUP_ROOT}/${slug}"
  out_file="${out_dir}/${TS}.dump"
  mkdir -p "$out_dir"

  if docker exec "$ctr" pg_dump -U secondlayer $DUMP_OPTS secondlayer > "$out_file" 2>/dev/null; then
    size=$(du -h "$out_file" | cut -f1)
    log "  ✓ $slug → $(basename "$out_file") ($size)"
  else
    log "  ✗ $slug — pg_dump failed"
    rm -f "$out_file"
    FAILED=$((FAILED + 1))
  fi
done

if [ "$FAILED" -gt 0 ]; then
  log "Completed with $FAILED failure(s)"
  exit 1
fi

log "All tenant backups complete"
