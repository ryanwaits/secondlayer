#!/bin/bash
# Nightly Docker image + build-cache cleanup.
#
# Problem: `$COMPOSE up -d --build` during deploys leaves dangling images
# and a growing build cache. Without this, root disk climbs ~1-2GB/week
# until secondlayer-agent auto-prunes reactively at 85% usage.
#
# Policy:
#   - `docker image prune -f`: remove dangling images only (images not
#     tagged and not referenced by any container). Safe — does NOT touch
#     images tagged for running or stopped services.
#   - `docker builder prune -f --reserved-space 2gb`: trim buildkit cache
#     older than the 2GB cap. Keeps recent cache warm for fast rebuilds.
#     (`--keep-storage` is the old alias, deprecated in newer docker.)
#
# What this does NOT do:
#   - `docker system prune -a` (deletes ALL unused images, including
#     tagged ones a stopped service might need on restart).
#   - `docker volume prune` (would nuke postgres data volume — never
#     safe on a data-bearing host).
#
# Usage: prune-docker-images.sh
# Cron:  0 2 * * * /opt/secondlayer/docker/scripts/prune-docker-images.sh >> /opt/secondlayer/data/backups/prune-docker.log 2>&1

set -euo pipefail

log() { echo "[$(date -Iseconds)] $*"; }

log "Disk before:"
df -h / | tail -1

log "Dangling images:"
docker image prune -f 2>&1 | sed 's/^/  /'

log "Build cache (reserved-space 2gb):"
docker builder prune -f --reserved-space 2gb 2>&1 | sed 's/^/  /'

log "Disk after:"
df -h / | tail -1

log "Done"
