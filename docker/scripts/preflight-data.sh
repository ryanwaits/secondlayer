#!/usr/bin/env bash
# Deploy preflight: refuse to proceed if either postgres is a husk or the
# compose no longer points at the real bind-mounted data dirs. Belt and
# braces for the bind-vs-named-volume drift class (bit prod twice, 2026-06).
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "✗ preflight-data: $1" >&2; exit 1; }

grep -q 'postgres:/var/lib/postgresql/data' docker-compose.hetzner.yml \
  || fail "hetzner overlay no longer binds the chain data dir"
grep -q 'postgres-platform:/var/lib/postgresql/data' docker-compose.hetzner.yml \
  || fail "hetzner overlay no longer binds the platform data dir"

# The chain DB: SOURCE_DATABASE_URL when set (a separate db host, queried from
# inside the platform postgres container so compose hostnames resolve), else
# the compose postgres container.
source_url="${SOURCE_DATABASE_URL:-$(grep -E '^SOURCE_DATABASE_URL=' .env 2>/dev/null | tail -1 | cut -d= -f2-)}"
blocks=""
if [ -n "$source_url" ]; then
  blocks=$(docker exec secondlayer-postgres-platform-1 psql "$source_url" -tAc 'SELECT count(*) FROM blocks' 2>/dev/null || echo 0)
elif docker ps --format '{{.Names}}' | grep -q '^secondlayer-postgres-1$'; then
  blocks=$(docker exec secondlayer-postgres-1 psql -U "${POSTGRES_USER:-secondlayer}" -d "${POSTGRES_DB:-secondlayer}" -tAc 'SELECT count(*) FROM blocks' 2>/dev/null || echo 0)
fi
if [ -n "$blocks" ]; then
  [ "${blocks:-0}" -ge "${CHAIN_MIN_BLOCK_COUNT:-1000000}" ] \
    || fail "chain DB has only ${blocks} blocks — looks like a husk, refusing to deploy"
fi
if docker ps --format '{{.Names}}' | grep -q '^secondlayer-postgres-platform-1$'; then
  accounts=$(docker exec secondlayer-postgres-platform-1 psql -U "${POSTGRES_USER:-secondlayer}" -d "${POSTGRES_PLATFORM_DB:-secondlayer_platform}" -tAc 'SELECT count(*) FROM accounts' 2>/dev/null || echo 0)
  [ "${accounts:-0}" -ge 1 ] || fail "platform DB has zero accounts — looks like a husk, refusing to deploy"
fi
echo "✓ preflight-data: both data planes look real"
