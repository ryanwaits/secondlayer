#!/bin/bash
set -euo pipefail

cd /opt/secondlayer
git fetch origin main
git reset --hard origin/main

cd docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"

# Build app images (migrate reuses api target, must be included)
$COMPOSE build api indexer worker agent migrate

# Run migrations synchronously — fail fast on error
$COMPOSE run --rm migrate

# Restart app services — NEVER touch stacks-node, postgres, hiro-postgres, hiro-api
$COMPOSE up -d api indexer worker view-processor agent caddy

# Health check
sleep 10
curl -sf http://localhost:3800/health > /dev/null && echo "api: healthy" || { echo "api: UNHEALTHY"; exit 1; }
curl -sf http://localhost:3700/health > /dev/null && echo "indexer: healthy" || { echo "indexer: UNHEALTHY"; exit 1; }
