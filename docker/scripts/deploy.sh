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

APP_SERVICES="api indexer worker subgraph-processor agent caddy"

# Services that hold locks on tables migrations mutate. Kept narrow on
# purpose — indexer's block/tx/event tables are independent of migrations
# we run, and stopping indexer needlessly risks pointless event-proxy
# buffering. If a future migration touches indexer tables, add it here.
MIGRATION_LOCK_HOLDERS="api subgraph-processor agent"

# Build app images — --no-cache ensures source code changes are always picked up
# subgraph-processor shares the api target but is listed explicitly for clarity
$COMPOSE build --no-cache api indexer worker subgraph-processor agent migrate

# Stop only the services that hold locks on migrated tables. DDL will then
# acquire ACCESS EXCLUSIVE without racing subgraph-processor's 5s poll or
# the api subgraphs-cache listener. postgres + indexer + stacks-node stay up.
echo "🛑 Stopping lock-holders so migrations can acquire ACCESS EXCLUSIVE..."
$COMPOSE stop $MIGRATION_LOCK_HOLDERS 2>/dev/null || true

# Force-remove orphan containers from removed/renamed services. These are
# live containers from older deploys whose service no longer exists in the
# compose files — `docker compose stop` misses them. Without this, an
# orphan (e.g. old workflow-runner) can hold locks on tables migrations
# want to drop or alter, causing indefinite hangs.
docker rm -f secondlayer-view-processor-1 secondlayer-workflow-runner-1 2>/dev/null || true

# Run migrations synchronously — fail fast on error
$COMPOSE run --rm migrate

# Clean up stale one-off containers (from manual `docker compose run` without --rm)
docker ps -a --filter "label=com.docker.compose.oneoff=True" -q | xargs -r docker rm -f 2>/dev/null || true

# Restart ALL app services — ensures any new code lands, and services that
# weren't stopped (indexer, worker, caddy) pick up new images via recreate.
# NEVER touch stacks-node, postgres, hiro-postgres, hiro-api.
$COMPOSE up -d --remove-orphans $APP_SERVICES

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
