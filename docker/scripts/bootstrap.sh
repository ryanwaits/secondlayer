#!/usr/bin/env bash
# Zero-to-indexed bootstrap for Second Layer on Hetzner AX52 (or any Docker host).
#
# Usage: bash docker/scripts/bootstrap.sh [--skip-backfill] [--data-dir /path]
#
# Phases:
#   1. Pre-flight checks
#   2. Core services (postgres, migrate, api, indexer, worker, view-processor)
#   3. Hiro postgres
#   4. Download + restore Hiro archive
#   5. Fix schema + PG auth
#   6. Start Hiro API, get chain tip
#   7. Bulk backfill (detached)
#   8. Stacks node + Caddy
#   9. Print status

set -euo pipefail

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
SKIP_BACKFILL=false
DATA_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-backfill) SKIP_BACKFILL=true; shift ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Resolve working directory — must run from docker/
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$DOCKER_DIR/.." && pwd)"
cd "$DOCKER_DIR"

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "==> $*"; }
warn() { echo "WARNING: $*" >&2; }
die()  { echo "FATAL: $*" >&2; exit 1; }

wait_healthy() {
  local svc="$1" max="${2:-60}"
  log "Waiting for $svc to be healthy..."
  for i in $(seq 1 "$max"); do
    status=$($COMPOSE ps "$svc" --format '{{.Status}}' 2>/dev/null || true)
    if echo "$status" | grep -qi "healthy"; then return 0; fi
    sleep 2
  done
  die "$svc did not become healthy after $((max * 2))s"
}

# ---------------------------------------------------------------------------
# Phase 1: Pre-flight
# ---------------------------------------------------------------------------
log "Phase 1: Pre-flight checks"

command -v docker >/dev/null 2>&1 || die "docker not found"
docker compose version >/dev/null 2>&1 || die "docker compose not found"

# .env
if [ ! -f .env ]; then
  if [ -f .env.hetzner.example ]; then
    cp .env.hetzner.example .env
    die ".env created from .env.hetzner.example — edit it and re-run"
  else
    die ".env not found"
  fi
fi

# Source .env
set -a
# shellcheck disable=SC1091
source .env
set +a

# Override DATA_DIR if passed via flag
if [ -n "$DATA_DIR" ]; then
  export DATA_DIR
fi
DATA_DIR="${DATA_DIR:-/opt/secondlayer/data}"

# Disk space check (need >200GB free)
AVAIL_KB=$(df --output=avail "$DATA_DIR" 2>/dev/null | tail -1 || df -k "$DATA_DIR" | tail -1 | awk '{print $4}')
AVAIL_GB=$((AVAIL_KB / 1024 / 1024))
if [ "$AVAIL_GB" -lt 200 ]; then
  warn "$DATA_DIR has only ${AVAIL_GB}GB free (need >200GB)"
fi

log "DATA_DIR=$DATA_DIR (${AVAIL_GB}GB free)"

# ---------------------------------------------------------------------------
# Phase 2: Core services
# ---------------------------------------------------------------------------
log "Phase 2: Starting core services"

$COMPOSE up -d postgres
wait_healthy postgres

$COMPOSE up migrate
$COMPOSE up -d api indexer worker view-processor

wait_healthy api
wait_healthy indexer
log "Core services healthy"

# ---------------------------------------------------------------------------
# Phase 3: Hiro Postgres
# ---------------------------------------------------------------------------
log "Phase 3: Starting hiro-postgres"

$COMPOSE up -d hiro-postgres
wait_healthy hiro-postgres
log "hiro-postgres healthy"

# ---------------------------------------------------------------------------
# Phase 4: Download + Restore Archive
# ---------------------------------------------------------------------------
log "Phase 4: Download + restore Hiro archive"

DUMP_FILE="${DATA_DIR}/hiro-pg-dump/hiro-api.dump"

if [ ! -f "$DUMP_FILE" ]; then
  bash scripts/download-hiro-archive.sh "$DATA_DIR"
fi

if [ -f "$DUMP_FILE" ]; then
  log "Copying dump into hiro-postgres container..."
  docker cp "$DUMP_FILE" docker-hiro-postgres-1:/tmp/hiro-api.dump

  # Monitor restore progress in background
  (
    while docker exec docker-hiro-postgres-1 psql -U postgres -d stacks_blockchain_api \
      -tAc "SELECT pg_size_pretty(pg_database_size('stacks_blockchain_api'));" 2>/dev/null; do
      sleep 60
    done
  ) &
  MONITOR_PID=$!

  log "Restoring PG dump (this takes 1-3 hours)..."
  docker exec docker-hiro-postgres-1 pg_restore \
    --username postgres --dbname stacks_blockchain_api \
    --jobs 4 --no-owner --no-privileges \
    /tmp/hiro-api.dump || true  # pg_restore returns non-zero on warnings

  kill "$MONITOR_PID" 2>/dev/null || true
  log "Restore complete"
else
  warn "No dump file at $DUMP_FILE — skipping restore"
fi

# ---------------------------------------------------------------------------
# Phase 5: Fix Schema + Auth
# ---------------------------------------------------------------------------
log "Phase 5: Fix schema"

# Rename schemas so archive data lands in public
docker exec docker-hiro-postgres-1 psql -U postgres -d stacks_blockchain_api -c "
  DO \$\$
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'stacks_blockchain_api') THEN
      ALTER SCHEMA stacks_blockchain_api RENAME TO public_old;
      ALTER SCHEMA public RENAME TO public_empty;
      ALTER SCHEMA public_old RENAME TO public;
    END IF;
  END \$\$;
"

# Verify
HIRO_TIP=$(docker exec docker-hiro-postgres-1 psql -U postgres -d stacks_blockchain_api \
  -tAc "SELECT MAX(block_height) FROM blocks;" 2>/dev/null || echo "unknown")
log "Hiro archive chain tip: $HIRO_TIP"

# Clean up dump files
rm -f "$DUMP_FILE"
docker exec docker-hiro-postgres-1 rm -f /tmp/hiro-api.dump
log "Schema fix done"

# ---------------------------------------------------------------------------
# Phase 6: Start Hiro API
# ---------------------------------------------------------------------------
log "Phase 6: Starting hiro-api"

$COMPOSE up -d hiro-api

log "Waiting for hiro-api to be ready..."
READY=""
for i in $(seq 1 30); do
  READY=$(docker exec docker-hiro-api-1 node -e \
    "fetch('http://127.0.0.1:3999/extended/v1/status').then(r=>r.json()).then(d=>console.log(d.status)).catch(()=>console.log('waiting'))" 2>/dev/null || echo "waiting")
  if [ "$READY" = "ready" ]; then break; fi
  sleep 2
done

if [ "$READY" != "ready" ]; then
  warn "hiro-api not ready after 60s — continuing anyway"
fi

# Get chain tip for backfill target
CHAIN_TIP=$(docker exec docker-hiro-api-1 node -e \
  "fetch('http://127.0.0.1:3999/extended/v1/status').then(r=>r.json()).then(d=>console.log(d.chain_tip.block_height)).catch(()=>console.log('0'))" 2>/dev/null || echo "0")
log "Chain tip from hiro-api: $CHAIN_TIP"

# ---------------------------------------------------------------------------
# Phase 7: Bulk Backfill (detached)
# ---------------------------------------------------------------------------
if [ "$SKIP_BACKFILL" = true ]; then
  log "Phase 7: Skipping backfill (--skip-backfill)"
else
  log "Phase 7: Starting bulk backfill"

  # Build workspace packages (needed for bulk-backfill imports)
  log "Building workspace packages..."
  docker run --rm -v "$REPO_DIR:/app" -w /app oven/bun:latest bun install
  docker run --rm -v "$REPO_DIR:/app" -w /app oven/bun:latest bun run build:shared
  docker run --rm -v "$REPO_DIR:/app" -w /app oven/bun:latest bun run --filter '@secondlayer/stacks' build

  # Remove old backfill container if exists
  docker rm -f backfill 2>/dev/null || true

  POSTGRES_USER="${POSTGRES_USER:-secondlayer}"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-secondlayer}"
  POSTGRES_DB="${POSTGRES_DB:-secondlayer}"

  docker run -d --name backfill \
    --network docker_default \
    -v "$REPO_DIR:/app" -w /app \
    -e HIRO_API_URL=http://hiro-api:3999 \
    -e HIRO_FALLBACK_URL=https://api.mainnet.hiro.so \
    -e HIRO_API_KEY="${HIRO_API_KEY:-}" \
    -e DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
    -e BACKFILL_INCLUDE_RAW_TX=false \
    -e BACKFILL_CONCURRENCY=10 \
    -e BACKFILL_BATCH_SIZE=100 \
    -e BACKFILL_FROM=2 \
    -e BACKFILL_TO="$CHAIN_TIP" \
    oven/bun:latest bun run packages/indexer/src/bulk-backfill.ts

  log "Backfill running (detached, raw_tx=false)"
fi

# ---------------------------------------------------------------------------
# Phase 8: Stacks Node + Caddy
# ---------------------------------------------------------------------------
log "Phase 8: Starting stacks-node + caddy"

$COMPOSE up -d stacks-node caddy

# ---------------------------------------------------------------------------
# Phase 9: Status
# ---------------------------------------------------------------------------
echo ""
log "Bootstrap complete"
echo ""
echo "Services:"
$COMPOSE ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""

if [ "$SKIP_BACKFILL" = false ]; then
  echo "Backfill running (detached, without raw_tx for speed):"
  echo "  docker logs backfill 2>&1 | grep 'Batch complete' | tail -5"
  echo ""
fi

echo "Monitor:"
echo "  docker logs backfill --tail 5           # backfill progress"
echo "  curl -s localhost:3700/health | jq .     # indexer health"
echo "  curl -s localhost:3800/health | jq .     # api health"
echo ""
echo "After backfill completes, run raw_tx pass:"
echo "  docker/scripts/backfill-raw-tx.sh"
