#!/usr/bin/env bash
# Run the published `sl` CLI against this host's prod database.
#
#   docker/scripts/sl.sh verify raw --against https://archive.secondlayer.tools/latest.json
#
# The host checkout has no built packages (deploy only installs deps; images
# build their own), so `bun packages/cli/src/cli.ts` imports stale or missing
# dist/. Instead run the released CLI — the same one customers run — in a
# throwaway container on the compose network, where the `postgres` alias is
# reachable and plain-TCP. Read-only commands only; the CLI says which write.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INDEXER_CONTAINER="${INDEXER_CONTAINER:-secondlayer-indexer-1}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-secondlayer-postgres-1}"

# Same Bun the images ship, so the CLI runs on the runtime we test against.
BUN_IMAGE=$(awk '/^FROM oven\/bun:.* AS base$/ {print $2; exit}' "$REPO_ROOT/docker/Dockerfile")
NETWORK=$(docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$POSTGRES_CONTAINER" | awk '{print $1}')
DATABASE_URL=$(docker exec "$INDEXER_CONTAINER" printenv SOURCE_DATABASE_URL)

[ -n "$BUN_IMAGE" ] || { echo "sl.sh: no oven/bun base image in docker/Dockerfile" >&2; exit 1; }
[ -n "$NETWORK" ] || { echo "sl.sh: $POSTGRES_CONTAINER is on no network" >&2; exit 1; }
[ -n "$DATABASE_URL" ] || { echo "sl.sh: $INDEXER_CONTAINER has no SOURCE_DATABASE_URL" >&2; exit 1; }

exec docker run --rm --network "$NETWORK" -e DATABASE_URL="$DATABASE_URL" \
  "$BUN_IMAGE" bunx @secondlayer/cli@latest "$@"
