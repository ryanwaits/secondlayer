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

cd /opt/secondlayer
git fetch origin main
git reset --hard origin/main

cd docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"

# Build app images — --no-cache ensures source code changes are always picked up
# subgraph-processor shares the api target but is listed explicitly for clarity
$COMPOSE build --no-cache api indexer worker subgraph-processor workflow-runner agent migrate

# Run migrations synchronously — fail fast on error
$COMPOSE run --rm migrate

# Clean up stale one-off containers (from manual `docker compose run` without --rm)
docker ps -a --filter "label=com.docker.compose.oneoff=True" -q | xargs -r docker rm -f 2>/dev/null || true

# Restart app services — NEVER touch stacks-node, postgres, hiro-postgres, hiro-api
# Remove orphaned containers from renamed services (view-processor → subgraph-processor)
docker rm -f secondlayer-view-processor-1 2>/dev/null || true
$COMPOSE up -d --remove-orphans api indexer worker subgraph-processor workflow-runner agent caddy

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
