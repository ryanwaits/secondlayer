#!/usr/bin/env bash
# Deploy preflight: refuse to proceed if either DB is a husk or the
# compose no longer points at the real bind-mounted platform data dir. Belt and
# braces for the bind-vs-named-volume drift class (bit prod twice, 2026-06).
set -euo pipefail
cd "$(dirname "$0")/../prod"

fail() { echo "✗ preflight-data: $1" >&2; exit 1; }

grep -q 'postgres-platform:/var/lib/postgresql/data' docker-compose.hetzner.yml \
  || fail "hetzner overlay no longer binds the platform data dir"

# The chain DB lives on db-server (SOURCE_DATABASE_URL), queried from inside the
# platform postgres container so compose hostnames resolve.
source_url="${SOURCE_DATABASE_URL:-$(grep -E '^SOURCE_DATABASE_URL=' .env 2>/dev/null | tail -1 | cut -d= -f2-)}"
[ -n "$source_url" ] || fail "SOURCE_DATABASE_URL is not set; the chain DB lives on db-server"
blocks=$(docker exec secondlayer-postgres-platform-1 psql "$source_url" -tAc 'SELECT count(*) FROM blocks' 2>/dev/null || echo 0)
[ "${blocks:-0}" -ge "${CHAIN_MIN_BLOCK_COUNT:-1000000}" ] \
  || fail "chain DB has only ${blocks} blocks — looks like a husk, refusing to deploy"
if docker ps --format '{{.Names}}' | grep -q '^secondlayer-postgres-platform-1$'; then
  accounts=$(docker exec secondlayer-postgres-platform-1 psql -U "${POSTGRES_USER:-secondlayer}" -d "${POSTGRES_PLATFORM_DB:-secondlayer_platform}" -tAc 'SELECT count(*) FROM accounts' 2>/dev/null || echo 0)
  [ "${accounts:-0}" -ge 1 ] || fail "platform DB has zero accounts — looks like a husk, refusing to deploy"
fi
echo "✓ preflight-data: both data planes look real"
