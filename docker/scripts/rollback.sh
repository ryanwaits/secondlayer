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

APP_SERVICES="api indexer decoder worker caddy"
DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-/opt/secondlayer/data/deploy}"
CURRENT_PATH="${DEPLOY_STATE_DIR}/current"
PREVIOUS_PATH="${DEPLOY_STATE_DIR}/previous"

DEPLOY_IMAGE_OWNER="${DEPLOY_IMAGE_OWNER:-secondlayer-labs}"
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

echo "Rollback image owner: ${DEPLOY_IMAGE_OWNER}"
echo "Rollback image tag: ${DEPLOY_IMAGE_TAG}"
echo "Rollback is image-only. Migrations will not run."

# Optional single-service rollback. Pin ONE dedicated-image service to
# ROLLBACK_IMAGE_TAG via its per-service tag var and recreate only it — the
# independent-rollback payoff of the per-service images. api/indexer/worker
# share images via DEPLOY_IMAGE_TAG and are not targetable here.
ROLLBACK_SERVICE="${ROLLBACK_SERVICE:-}"
if [ -n "$ROLLBACK_SERVICE" ]; then
	case "$ROLLBACK_SERVICE" in
		decoder) _svc_tag_var=DECODER_IMAGE_TAG ;;
		*)
			echo "ERROR: ROLLBACK_SERVICE must be one of: decoder"
			exit 2
			;;
	esac
	export "${_svc_tag_var}=${ROLLBACK_IMAGE_TAG}"
	echo "🎯 Single-service rollback: ${ROLLBACK_SERVICE} → ${ROLLBACK_IMAGE_TAG} (all other services untouched)"
	$COMPOSE pull "$ROLLBACK_SERVICE"
	$COMPOSE up -d --no-build --no-deps --force-recreate "$ROLLBACK_SERVICE"
	# Inline health wait — the shared helper is defined later; keep this block self-contained.
	_container="secondlayer-${ROLLBACK_SERVICE}-1"
	for _i in $(seq 1 10); do
		_h=$(docker inspect "$_container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)
		if [ "$_h" = "healthy" ] || [ "$_h" = "running" ]; then
			echo "${ROLLBACK_SERVICE}: ${_h}"
			break
		fi
		echo "${ROLLBACK_SERVICE}: health=${_h:-missing}, attempt ${_i}/10..."
		sleep 6
	done
	echo "Single-service rollback complete. Deploy-state markers left unchanged (targeted pin, not a full rollback)."
	exit 0
fi

# Pull exact images before changing any running containers.
$COMPOSE pull api indexer decoder worker migrate

# Recreate only runtime services. --no-deps prevents compose from starting the
# migrate dependency as part of rollback.
$COMPOSE up -d --no-build --no-deps --force-recreate --remove-orphans $APP_SERVICES

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

check_container_health decoder

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
