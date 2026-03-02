#!/usr/bin/env bash
# Pre-upgrade snapshot: backup both postgres DBs + upload to Storage Box
# Usage: pre-upgrade-snapshot.sh
# Run before any docker compose upgrades
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

log() { echo "[$(date -Iseconds)] $*"; }

log "=== Pre-upgrade snapshot ==="

log "Backing up secondlayer postgres..."
"$SCRIPT_DIR/backup-postgres.sh"

log "Backing up hiro postgres..."
"$SCRIPT_DIR/backup-hiro-postgres.sh"

log "Uploading to Storage Box..."
"$SCRIPT_DIR/upload-snapshot.sh"

log "=== Pre-upgrade snapshot complete ==="
