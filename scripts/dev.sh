#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker/docker-compose.dev.yml"
DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/secondlayer"

# Colors
dim='\033[2m'
bold='\033[1m'
green='\033[32m'
reset='\033[0m'

cleanup() {
  echo ""
  echo -e "${dim}Stopping services...${reset}"
  kill 0 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

echo -e "${bold}secondlayer dev${reset}"
echo ""

# 1. Start Postgres
echo -e "${dim}Starting postgres...${reset}"
docker compose -f "$COMPOSE_FILE" up -d --wait

# 2. Run migrations
echo -e "${dim}Running migrations...${reset}"
DATABASE_URL="$DB_URL" bun run packages/shared/src/db/migrate.ts

echo ""

# 3. Start API + Web in parallel
echo -e "${green}Starting api (3800) + web (3000)${reset}"
echo ""

DATABASE_URL="$DB_URL" DEV_MODE=true bun run --filter @secondlayer/api dev &
SL_API_URL="http://localhost:3800" bun run --filter @secondlayer/web dev &

wait
