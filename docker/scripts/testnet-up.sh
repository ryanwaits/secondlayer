#!/usr/bin/env bash
# Move the testnet stack to the images deploy just rolled. No-op until
# docker/testnet/.env exists. Runs detached from deploy: it can never fail,
# hang or delay a mainnet deploy.
set -uo pipefail
OWNER="$1"; TAG="$2"
cd "$(dirname "$0")/.." || exit 0
[ -f testnet/.env ] || exit 0
sed -i "s|^TESTNET_IMAGE_OWNER=.*|TESTNET_IMAGE_OWNER=$OWNER|; s|^TESTNET_IMAGE_TAG=.*|TESTNET_IMAGE_TAG=$TAG|" testnet/.env
unset COMPOSE_PROJECT_NAME COMPOSE_FILE
C=(docker compose -p secondlayer-testnet -f testnet/docker-compose.yml --env-file testnet/.env)
# A killed earlier run could still hold kysely's migration lock.
docker ps -a -q --filter label=com.docker.compose.project=secondlayer-testnet --filter label=com.docker.compose.oneoff=True | xargs -r docker rm -f
"${C[@]}" run --rm testnet-migrate || { echo "testnet migrate failed"; exit 1; }
"${C[@]}" up -d testnet-postgres testnet-indexer testnet-decoder testnet-api
