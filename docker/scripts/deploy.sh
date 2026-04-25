#!/bin/bash
set -euo pipefail

# Ensure PATH includes essential directories (fixes broken .bashrc on some systems)
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$HOME/.bun/bin:$PATH"

# Verify critical commands exist
for cmd in git docker curl; do
	if ! command -v $cmd &> /dev/null; then
		echo "ERROR: $cmd not found in PATH"
		exit 1
	fi
done

# Two-stage bootstrap. Bash buffers short scripts at invocation time, so if we
# pull + reset + continue in the same process, the rest of this file runs with
# the OLD buffered content against the NEW compose/migration files on disk.
# Pull first, then exec ourselves — the fresh process re-reads the file.
if [ "${DEPLOY_REEXECED:-0}" != "1" ]; then
	cd /opt/secondlayer
	git fetch origin main
	git reset --hard origin/main
	export DEPLOY_REEXECED=1
	exec bash /opt/secondlayer/docker/scripts/deploy.sh
fi

cd /opt/secondlayer/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"

if [ -f .env ]; then
	set -a
	# shellcheck disable=SC1091
	source .env
	set +a
fi

APP_SERVICES="api indexer worker agent caddy"
PLATFORM_SERVICES="provisioner"

# Services that hold locks on tables migrations mutate. Indexer stays up
# because its tables (blocks/transactions/events/index_progress) are
# independent of control-plane tables that migrations touch.
MIGRATION_LOCK_HOLDERS="api agent worker"

# Build app + platform images — --no-cache ensures source changes always land.
$COMPOSE build --no-cache api indexer worker agent migrate
$COMPOSE --profile platform build --no-cache provisioner

# Tenant containers are created by the provisioner from the configured API image
# name. Tag the freshly built local API image so tenant refresh/resume uses this
# exact deploy, without racing GHCR's async `latest` publication workflow.
docker tag \
	secondlayer-api:latest \
	"ghcr.io/${PROVISIONER_IMAGE_OWNER:-secondlayer-labs}/secondlayer-api:${PROVISIONER_IMAGE_TAG:-latest}"

# Stop only the services that hold locks on migrated tables. DDL then
# acquires ACCESS EXCLUSIVE without racing the api subgraphs-cache
# listener. postgres + indexer + stacks-node stay up.
echo "🛑 Stopping lock-holders so migrations can acquire ACCESS EXCLUSIVE..."
$COMPOSE stop $MIGRATION_LOCK_HOLDERS 2>/dev/null || true

# Force-remove orphan containers from removed/renamed services. These are
# live containers from older deploys whose service no longer exists in the
# compose files — `docker compose stop` misses them. Without this, an
# orphan can hold locks on tables migrations want to drop or alter,
# causing indefinite hangs.
docker rm -f secondlayer-view-processor-1 2>/dev/null || true

# Force-remove any zombie one-off migrate containers from prior deploys.
# If a previous `docker compose run --rm migrate` was killed mid-flight by
# SSH timeout, the container keeps running and holds kysely's advisory
# migration lock — new migrate runs then wait forever. Cleanup BEFORE, not
# after, so the new migrate run starts with a clean slate.
echo "🧹 Cleaning up stale one-off migrate containers from prior deploys..."
docker ps -a --filter "label=com.docker.compose.oneoff=True" --filter "label=com.docker.compose.service=migrate" -q \
  | xargs -r docker rm -f 2>/dev/null || true

# Terminate every remaining session on the DB. Docker stop should have
# dropped these, but TCP-half-closed connections can linger with pg
# sessions alive for minutes — and prior diagnostic runs showed ~20 stuck
# `select * from subgraphs` queries queued behind our ALTER. Killing them
# now guarantees ACCESS EXCLUSIVE on subgraphs can be acquired immediately.
# Indexer (which we kept running) auto-reconnects via postgres.js on next
# statement — zero block loss, by design.
echo "🔌 Terminating zombie sessions on tenant DB..."
docker exec secondlayer-postgres-1 psql -U "${POSTGRES_USER:-secondlayer}" -d "${POSTGRES_DB:-secondlayer}" -c "
  SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND pid <> pg_backend_pid();
" 2>/dev/null || true

# Run migrations synchronously — fail fast on error
$COMPOSE run --rm migrate

# Clean up stale one-off containers (from manual `docker compose run` without --rm)
docker ps -a --filter "label=com.docker.compose.oneoff=True" -q | xargs -r docker rm -f 2>/dev/null || true

# Restart ALL app services — ensures any new code lands, and services that
# weren't stopped (indexer, worker, caddy) pick up new images via recreate.
# NEVER touch stacks-node, postgres, hiro-postgres, hiro-api.
$COMPOSE up -d --remove-orphans $APP_SERVICES

# Platform-mode services (provisioner, behind --profile platform). Must be
# recreated separately so compose changes to the provisioner land on deploy
# instead of requiring a manual `--force-recreate provisioner` after.
$COMPOSE --profile platform up -d --remove-orphans $PLATFORM_SERVICES

# Health check with retry
check_health() {
  local name=$1 url=$2 retries=5 delay=5
  for i in $(seq 1 $retries); do
    if curl -sf "$url" > /dev/null 2>&1; then
      echo "$name: healthy"
      return 0
    fi
    echo "$name: attempt $i/$retries failed, retrying in ${delay}s..."
    sleep $delay
  done
  echo "$name: UNHEALTHY after $retries attempts"
  docker logs secondlayer-${name}-1 --tail 30 2>&1 || true
  return 1
}

sleep 5
check_health api http://localhost:3800/health
check_health indexer http://localhost:3700/health
check_health provisioner http://localhost:3850/health

refresh_active_tenants() {
  if [ -z "${PROVISIONER_SECRET:-}" ]; then
    echo "⚠️  PROVISIONER_SECRET unset; skipping tenant runtime refresh"
    return 0
  fi

  echo "🔄 Refreshing active tenant runtimes..."
  local slugs
  slugs=$(docker exec secondlayer-postgres-1 psql \
    -U "${POSTGRES_USER:-secondlayer}" \
    -d "${POSTGRES_DB:-secondlayer}" \
    -Atc "SELECT slug FROM tenants WHERE status = 'active' ORDER BY slug;" \
    2>/dev/null || true)

  if [ -z "$slugs" ]; then
    echo "No active tenants to refresh."
    return 0
  fi

  while IFS= read -r slug; do
    [ -z "$slug" ] && continue
    echo "Refreshing tenant ${slug}..."
    if ! curl -sfS \
      -X POST "http://localhost:3850/tenants/${slug}/resume" \
      -H "x-provisioner-secret: ${PROVISIONER_SECRET}" \
      >/dev/null; then
      echo "⚠️  Tenant ${slug} refresh failed"
    fi
  done <<< "$slugs"

  return 0
}

refresh_active_tenants
