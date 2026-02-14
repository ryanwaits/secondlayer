#!/usr/bin/env bash
# Fill raw_tx hex for transactions stored with placeholder "0x00" during fast backfill.
# Run after bootstrap.sh bulk backfill completes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$DOCKER_DIR/.." && pwd)"
cd "$DOCKER_DIR"

# shellcheck disable=SC1091
source .env

docker rm -f backfill-raw-tx 2>/dev/null || true

POSTGRES_USER="${POSTGRES_USER:-secondlayer}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-secondlayer}"
POSTGRES_DB="${POSTGRES_DB:-secondlayer}"

docker run -d --name backfill-raw-tx \
  --network docker_default \
  -v "$REPO_DIR:/app" -w /app \
  -e HIRO_API_URL=http://hiro-api:3999 \
  -e HIRO_FALLBACK_URL=https://api.mainnet.hiro.so \
  -e HIRO_API_KEY="${HIRO_API_KEY:-}" \
  -e DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e BACKFILL_RAW_TX_CONCURRENCY="${BACKFILL_RAW_TX_CONCURRENCY:-10}" \
  -e BACKFILL_RAW_TX_BATCH_SIZE="${BACKFILL_RAW_TX_BATCH_SIZE:-500}" \
  oven/bun:latest bun run packages/indexer/src/backfill-raw-tx.ts

echo "==> backfill-raw-tx running (detached)"
echo "    docker logs backfill-raw-tx --tail 10"
