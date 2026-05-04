#!/bin/bash
set -euo pipefail

# Ensure PATH includes essential directories (fixes broken .bashrc on some systems)
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${HOME:-/root}/.bun/bin:${PATH:-}"

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

APP_SERVICES="api indexer l2-decoder worker agent caddy"
PLATFORM_SERVICES="provisioner"
TENANT_API_DIGEST_LABEL="org.opencontainers.image.secondlayer.api-source-digest"
DEPLOY_IMAGE_OWNER="${DEPLOY_IMAGE_OWNER:-${PROVISIONER_IMAGE_OWNER:-secondlayer-labs}}"
DEPLOY_IMAGE_TAG="${DEPLOY_IMAGE_TAG:-${DEPLOY_SHA:-latest}}"
DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-/opt/secondlayer/data/deploy}"
export DEPLOY_IMAGE_OWNER DEPLOY_IMAGE_TAG
export PROVISIONER_IMAGE_OWNER="$DEPLOY_IMAGE_OWNER"
export PROVISIONER_IMAGE_TAG="$DEPLOY_IMAGE_TAG"
TENANT_API_IMAGE="ghcr.io/${DEPLOY_IMAGE_OWNER}/secondlayer-api:${DEPLOY_IMAGE_TAG}"

# Services that hold locks on tables migrations mutate. Indexer and l2-decoder
# write L1/L2 tables, so migrations must complete before they restart on new code.
MIGRATION_LOCK_HOLDERS="api indexer l2-decoder agent worker"

echo "Deploy image owner: ${DEPLOY_IMAGE_OWNER}"
echo "Deploy image tag: ${DEPLOY_IMAGE_TAG}"
echo "Tenant API image: ${TENANT_API_IMAGE}"

# Pull exact CI-built images before stopping services. If GHCR is missing any
# image for this SHA, fail while the current deployment is still running.
$COMPOSE pull api indexer l2-decoder worker agent migrate
$COMPOSE --profile platform pull provisioner

# Stop only the services that hold locks on migrated tables. DDL then acquires
# ACCESS EXCLUSIVE without racing app or indexer sessions.
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
# Services auto-reconnect via postgres.js on their next statement after restart.
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

# Restart all app services so every runtime picks up the pulled image tag.
# NEVER touch stacks-node, postgres, hiro-postgres, hiro-api.
$COMPOSE up -d --no-build --remove-orphans $APP_SERVICES

# Platform-mode services (provisioner, behind --profile platform). Must be
# recreated separately so compose changes to the provisioner land on deploy
# instead of requiring a manual `--force-recreate provisioner` after.
$COMPOSE --profile platform up -d --no-build --remove-orphans $PLATFORM_SERVICES

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
    echo "⚠️  PROVISIONER_SECRET unset; skipping tenant runtime refresh"
    return 0
  fi

  local target_digest
  target_digest=$(docker image inspect "$TENANT_API_IMAGE" \
    --format "{{ index .Config.Labels \"${TENANT_API_DIGEST_LABEL}\" }}" \
    2>/dev/null || true)

  if [ -z "$target_digest" ] || [ "$target_digest" = "<no value>" ]; then
    echo "⚠️  Target tenant API image has no source digest label; refreshing active tenants"
  else
    echo "Tenant API target digest: ${target_digest}"
  fi

  echo "🔎 Checking active tenant runtimes..."
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
    local image_id current_digest
    image_id=$(docker inspect "sl-api-${slug}" --format '{{ .Image }}' 2>/dev/null || true)
    current_digest=""
    if [ -n "$image_id" ]; then
      current_digest=$(docker image inspect "$image_id" \
        --format "{{ index .Config.Labels \"${TENANT_API_DIGEST_LABEL}\" }}" \
        2>/dev/null || true)
    fi

    if [ -n "$target_digest" ] && [ "$target_digest" != "<no value>" ] && [ "$current_digest" = "$target_digest" ]; then
      echo "Tenant ${slug} already on current API image; skipping refresh."
      continue
    fi

    if [ -z "$current_digest" ] || [ "$current_digest" = "<no value>" ]; then
      echo "Refreshing tenant ${slug} (missing current API digest)..."
    else
      echo "Refreshing tenant ${slug} (${current_digest} -> ${target_digest})..."
    fi
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

record_successful_deploy() {
  mkdir -p "$DEPLOY_STATE_DIR"

  local current_path="${DEPLOY_STATE_DIR}/current"
  local previous_path="${DEPLOY_STATE_DIR}/previous"
  local metadata_path="${DEPLOY_STATE_DIR}/last-success.env"
  local current=""

  if [ -f "$current_path" ]; then
    current="$(cat "$current_path")"
  fi

  if [ -n "$current" ] && [ "$current" != "$DEPLOY_IMAGE_TAG" ]; then
    printf '%s\n' "$current" > "$previous_path"
  fi

  printf '%s\n' "$DEPLOY_IMAGE_TAG" > "$current_path"
  {
    printf 'DEPLOY_IMAGE_OWNER=%q\n' "$DEPLOY_IMAGE_OWNER"
    printf 'DEPLOY_IMAGE_TAG=%q\n' "$DEPLOY_IMAGE_TAG"
    printf 'DEPLOY_SHA=%q\n' "${DEPLOY_SHA:-}"
    printf 'DEPLOY_RECORDED_AT=%q\n' "$(date -Iseconds)"
  } > "$metadata_path"

  echo "Recorded successful deploy state in ${DEPLOY_STATE_DIR}"
}

record_successful_deploy
