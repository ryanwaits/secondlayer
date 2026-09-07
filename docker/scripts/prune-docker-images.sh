#!/bin/bash
# Nightly Docker image + build-cache cleanup.
#
# Every deploy tags a new SHA on 5+ images. Those tags keep the layers
# alive forever. `docker image prune` (dangling only) reclaims nothing
# once everything is tagged — which is how ~3,500 SHA tags accumulated
# and the archive exporter died at 91GB free against a 100GB disk-guard
# (2026-09-06). Disk was climbing ~3GB/day; nightly prune logged 0B.
#
# Policy:
#   - `docker image prune -f`: dangling (untagged) images. Safe.
#   - `docker image prune -a -f --filter until=168h`: unused tagged
#     images older than 7 days. Running/stopped containers keep their
#     images. Rollback only needs `current` + `previous` (hours old);
#     GHCR still holds older SHAs if a deeper rollback is ever required.
#   - `docker builder prune -f --reserved-space 2gb`: trim buildkit cache.
#
# What this does NOT do:
#   - `docker volume prune` (would nuke postgres data — never).
#   - Unused images younger than 7 days (recent rollback window).
#
# Usage: prune-docker-images.sh
# Cron:  0 2 * * * /opt/secondlayer/docker/scripts/prune-docker-images.sh >> /opt/secondlayer/data/backups/prune-docker.log 2>&1

set -euo pipefail

log() { echo "[$(date -Iseconds)] $*"; }

log "Disk before:"
df -h / | tail -1

log "Dangling images:"
docker image prune -f 2>&1 | sed 's/^/  /'

# 7 days. Rollback reads /opt/secondlayer/data/deploy/previous (the last
# successful SHA). Keeping a week of unused tags is the buffer; keeping
# every SHA is how the disk-guard trips.
log "Unused tagged images older than 7d:"
docker image prune -a -f --filter "until=168h" 2>&1 | sed 's/^/  /'

log "Build cache (reserved-space 2gb):"
docker builder prune -f --reserved-space 2gb 2>&1 | sed 's/^/  /'

log "Disk after:"
df -h / | tail -1

log "Done"
