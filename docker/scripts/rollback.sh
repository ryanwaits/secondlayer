#!/bin/bash
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${HOME:-/root}/.bun/bin:${PATH:-}"

for cmd in docker curl; do
	if ! command -v "$cmd" &> /dev/null; then
		echo "ERROR: $cmd not found in PATH"
		exit 1
	fi
done

cd /opt/secondlayer/docker
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"

if [ -f .env ]; then
	set -a
	# shellcheck disable=SC1091
	source .env
	set +a
fi

APP_SERVICES="api indexer l2-decoder worker agent caddy"
PLATFORM_SERVICES="provisioner"
TENANT_API_DIGEST_LABEL="org.opencontainers.image.secondlayer.api-source-digest"
DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-/opt/secondlayer/data/deploy}"
CURRENT_PATH="${DEPLOY_STATE_DIR}/current"
PREVIOUS_PATH="${DEPLOY_STATE_DIR}/previous"

DEPLOY_IMAGE_OWNER="${DEPLOY_IMAGE_OWNER:-${PROVISIONER_IMAGE_OWNER:-secondlayer-labs}}"
ROLLBACK_IMAGE_TAG="${ROLLBACK_IMAGE_TAG:-}"

if [ -z "$ROLLBACK_IMAGE_TAG" ]; then
	if [ ! -s "$PREVIOUS_PATH" ]; then
		echo "ERROR: no rollback image tag supplied and ${PREVIOUS_PATH} is missing or empty"
		exit 2
	fi
	ROLLBACK_IMAGE_TAG="$(cat "$PREVIOUS_PATH")"
fi

DEPLOY_IMAGE_TAG="$ROLLBACK_IMAGE_TAG"
export DEPLOY_IMAGE_OWNER DEPLOY_IMAGE_TAG
export PROVISIONER_IMAGE_OWNER="$DEPLOY_IMAGE_OWNER"
export PROVISIONER_IMAGE_TAG="$DEPLOY_IMAGE_TAG"
TENANT_API_IMAGE="ghcr.io/${DEPLOY_IMAGE_OWNER}/secondlayer-api:${DEPLOY_IMAGE_TAG}"

echo "Rollback image owner: ${DEPLOY_IMAGE_OWNER}"
echo "Rollback image tag: ${DEPLOY_IMAGE_TAG}"
echo "Tenant API image: ${TENANT_API_IMAGE}"
echo "Rollback is image-only. Migrations will not run."

# Pull exact images before changing any running containers.
$COMPOSE pull api indexer l2-decoder worker agent migrate
$COMPOSE --profile platform pull provisioner

# Recreate only runtime services. --no-deps prevents compose from starting the
# migrate dependency as part of rollback.
$COMPOSE up -d --no-build --no-deps --force-recreate --remove-orphans $APP_SERVICES
$COMPOSE --profile platform up -d --no-build --no-deps --force-recreate --remove-orphans $PLATFORM_SERVICES

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

check_container_health() {
	local service=$1
	local container="secondlayer-${service}-1" retries=10 delay=6
	for i in $(seq 1 $retries); do
		local health
		health=$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
		if [ "$health" = "healthy" ] || [ "$health" = "running" ]; then
			echo "$service: ${health}"
			return 0
		fi
		echo "$service: health=${health:-missing}, attempt $i/$retries, retrying in ${delay}s..."
		sleep $delay
	done
	echo "$service: UNHEALTHY after $retries attempts"
	docker logs "$container" --tail 50 2>&1 || true
	return 1
}

check_container_health l2-decoder

refresh_active_tenants() {
	if [ -z "${PROVISIONER_SECRET:-}" ]; then
		echo "PROVISIONER_SECRET unset; skipping tenant runtime refresh"
		return 0
	fi

	local target_digest
	target_digest=$(docker image inspect "$TENANT_API_IMAGE" \
		--format "{{ index .Config.Labels \"${TENANT_API_DIGEST_LABEL}\" }}" \
		2>/dev/null || true)

	if [ -z "$target_digest" ] || [ "$target_digest" = "<no value>" ]; then
		echo "Target tenant API image has no source digest label; refreshing active tenants"
	else
		echo "Tenant API target digest: ${target_digest}"
	fi

	echo "Checking active tenant runtimes..."
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
		echo "Refreshing tenant ${slug} to rollback image..."
		if ! curl -sfS \
			-X POST "http://localhost:3850/tenants/${slug}/resume" \
			-H "x-provisioner-secret: ${PROVISIONER_SECRET}" \
			>/dev/null; then
			echo "Tenant ${slug} refresh failed"
		fi
	done <<< "$slugs"

	return 0
}

refresh_active_tenants

record_successful_rollback() {
	mkdir -p "$DEPLOY_STATE_DIR"

	local current=""
	if [ -f "$CURRENT_PATH" ]; then
		current="$(cat "$CURRENT_PATH")"
	fi

	if [ -n "$current" ] && [ "$current" != "$DEPLOY_IMAGE_TAG" ]; then
		printf '%s\n' "$current" > "$PREVIOUS_PATH"
	fi

	printf '%s\n' "$DEPLOY_IMAGE_TAG" > "$CURRENT_PATH"
	{
		printf 'DEPLOY_IMAGE_OWNER=%q\n' "$DEPLOY_IMAGE_OWNER"
		printf 'DEPLOY_IMAGE_TAG=%q\n' "$DEPLOY_IMAGE_TAG"
		printf 'ROLLBACK_RECORDED_AT=%q\n' "$(date -Iseconds)"
	} > "${DEPLOY_STATE_DIR}/last-rollback.env"

	echo "Recorded successful rollback state in ${DEPLOY_STATE_DIR}"
}

record_successful_rollback
