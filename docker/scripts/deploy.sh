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

# Refuse to deploy against husk databases or a de-bound overlay (the
# bind-vs-named-volume drift class). See scripts/preflight-data.sh.
./scripts/preflight-data.sh

# Snapshot vars supplied by the deploy invocation (CI workflow env or manual
# operator export) BEFORE sourcing .env. `record_successful_deploy` persists
# these keys into .env at the end of every successful deploy, so once a deploy
# has run on this host the .env values are baked-in and would silently
# override anything the next deploy passes in. Treat .env as defaults, not
# higher-priority overrides.
_DEPLOY_IMAGE_OWNER_OVERRIDE="${DEPLOY_IMAGE_OWNER:-}"
_DEPLOY_IMAGE_TAG_OVERRIDE="${DEPLOY_IMAGE_TAG:-}"
_DEPLOY_SHA_OVERRIDE="${DEPLOY_SHA:-}"

if [ -f .env ]; then
	set -a
	# shellcheck disable=SC1091
	source .env
	set +a
fi

# Re-apply overrides on top of .env defaults. Empty override means "fall back
# to whatever .env or builtin defaults produced."
[ -n "$_DEPLOY_IMAGE_OWNER_OVERRIDE" ] && DEPLOY_IMAGE_OWNER="$_DEPLOY_IMAGE_OWNER_OVERRIDE"
[ -n "$_DEPLOY_IMAGE_TAG_OVERRIDE" ] && DEPLOY_IMAGE_TAG="$_DEPLOY_IMAGE_TAG_OVERRIDE"
[ -n "$_DEPLOY_SHA_OVERRIDE" ] && DEPLOY_SHA="$_DEPLOY_SHA_OVERRIDE"
unset _DEPLOY_IMAGE_OWNER_OVERRIDE _DEPLOY_IMAGE_TAG_OVERRIDE _DEPLOY_SHA_OVERRIDE

APP_SERVICES="api indexer l2-decoder subgraph-processor subscription-processor worker caddy"
# api recreates separately (rolling, replica-by-replica behind Caddy) so its
# cached read plane never goes fully dark on a code-only deploy. Everything else
# recreates in bulk.
APP_SERVICES_NO_API="indexer l2-decoder subgraph-processor subscription-processor worker caddy"
DEPLOY_IMAGE_OWNER="${DEPLOY_IMAGE_OWNER:-secondlayer-labs}"
DEPLOY_IMAGE_TAG="${DEPLOY_IMAGE_TAG:-${DEPLOY_SHA:-latest}}"
DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-/opt/secondlayer/data/deploy}"
DB_MAINTENANCE_LOCK_FILE="${DB_MAINTENANCE_LOCK_FILE:-${DATA_DIR:-/opt/secondlayer/data}/db-maintenance.lock}"
DB_MAINTENANCE_LOCK_TIMEOUT_SECONDS="${DB_MAINTENANCE_LOCK_TIMEOUT_SECONDS:-2700}"
export DEPLOY_IMAGE_OWNER DEPLOY_IMAGE_TAG

# Services that hold locks on tables migrations mutate. Indexer and l2-decoder
# write L1/L2 tables, so migrations must complete before they restart on new code.
MIGRATION_LOCK_HOLDERS="api indexer l2-decoder worker"

echo "Deploy image owner: ${DEPLOY_IMAGE_OWNER}"
echo "Deploy image tag: ${DEPLOY_IMAGE_TAG}"

# Pull exact CI-built images before stopping services. If GHCR is missing any
# image for this SHA, fail while the current deployment is still running.
# Skip the pull entirely when every required image is already cached locally
# (no-op re-deploys, rollbacks to a recent SHA, CI pre-pull from build-images).
_pull_services=(api indexer l2-decoder subgraph-processor subscription-processor worker migrate)
_expected_images=$($COMPOSE config --images "${_pull_services[@]}" 2>/dev/null | sort -u)
_missing_images=()
while IFS= read -r _img; do
  [ -z "$_img" ] && continue
  docker image inspect "$_img" >/dev/null 2>&1 || _missing_images+=("$_img")
done <<< "$_expected_images"

if [ ${#_missing_images[@]} -eq 0 ]; then
  echo "✅ All deploy images for ${DEPLOY_IMAGE_TAG} already present locally — skipping pull"
else
  echo "📥 Pulling ${#_missing_images[@]} missing image(s):"
  printf '   %s\n' "${_missing_images[@]}"
  $COMPOSE pull "${_pull_services[@]}"
fi
unset _pull_services _expected_images _missing_images _img

# Detect whether this deploy actually touches migrations. The full
# stop-holders → terminate-sessions → run-migrate sequence is only needed
# when SQL has changed; for code-only or chore deploys we can skip ~10-30s
# of lock churn and let `compose up -d` do a rolling restart instead.
_prev_sha=""
if [ -f "${DEPLOY_STATE_DIR}/current" ]; then
  _prev_sha="$(cat "${DEPLOY_STATE_DIR}/current" 2>/dev/null || true)"
fi
MIGRATIONS_CHANGED=true
if [ -n "$_prev_sha" ] && [ -n "${DEPLOY_SHA:-}" ] && [ "$_prev_sha" != "$DEPLOY_SHA" ]; then
  if git -C /opt/secondlayer rev-parse --verify "$_prev_sha^{commit}" >/dev/null 2>&1 \
     && git -C /opt/secondlayer rev-parse --verify "$DEPLOY_SHA^{commit}" >/dev/null 2>&1; then
    if [ -z "$(git -C /opt/secondlayer diff --name-only "$_prev_sha" "$DEPLOY_SHA" -- packages/shared/migrations/ 2>/dev/null)" ]; then
      MIGRATIONS_CHANGED=false
    fi
  fi
fi
PREV_SHA="$_prev_sha"
unset _prev_sha

# Always acquire the maintenance lock so two deploys can't race regardless
# of migration state.
mkdir -p "$(dirname "$DB_MAINTENANCE_LOCK_FILE")"
exec 9>"$DB_MAINTENANCE_LOCK_FILE"
echo "🔒 Waiting for DB maintenance lock ${DB_MAINTENANCE_LOCK_FILE}..."
if ! flock -w "$DB_MAINTENANCE_LOCK_TIMEOUT_SECONDS" 9; then
  echo "ERROR: timed out waiting for DB maintenance lock after ${DB_MAINTENANCE_LOCK_TIMEOUT_SECONDS}s"
  exit 1
fi

# Force-remove orphan containers from removed/renamed services. These are
# live containers from older deploys whose service no longer exists in the
# compose files — `docker compose stop` misses them. Always safe and cheap.
docker rm -f secondlayer-view-processor-1 2>/dev/null || true

if [ "$MIGRATIONS_CHANGED" = "true" ]; then
  # Stop only the services that hold locks on migrated tables. DDL then acquires
  # ACCESS EXCLUSIVE without racing app or indexer sessions.
  echo "🛑 Stopping lock-holders so migrations can acquire ACCESS EXCLUSIVE..."
  $COMPOSE stop $MIGRATION_LOCK_HOLDERS 2>/dev/null || true

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
else
  echo "✅ No migration files changed between ${PREV_SHA:-unknown}..${DEPLOY_SHA} — skipping stop + migrate"
fi

# Clean up stale one-off containers (from manual `docker compose run` without --rm)
docker ps -a --filter "label=com.docker.compose.oneoff=True" -q | xargs -r docker rm -f 2>/dev/null || true

# Wait until at least `$1` api replicas are running AND every one answers
# /health from inside its network (no host port — api is reached over the
# compose network / Caddy). Gating on COUNT too prevents a half-dark pool (one
# replica answering while the other is gone) from being reported healthy.
wait_api_healthy() {
  local want="${1:-1}" retries=20 delay=3 i cids n c all_ok
  for i in $(seq 1 $retries); do
    cids=$($COMPOSE ps -q api 2>/dev/null || true)
    n=$(printf '%s\n' "$cids" | grep -c .)
    if [ "$n" -ge "$want" ]; then
      all_ok=1
      for c in $cids; do
        docker exec "$c" curl -sf http://localhost:3800/health >/dev/null 2>&1 || all_ok=0
      done
      [ "$all_ok" = 1 ] && return 0
    fi
    echo "api: waiting for $want healthy replica(s), have ${n} (attempt $i/$retries)..."
    sleep $delay
  done
  return 1
}

# Recreate api replicas one at a time so the load-balanced pool keeps serving.
# Removing a replica then `up --no-recreate` recreates only that missing slot
# with the new image; survivors stay on the old image until their turn. Caddy's
# `dynamic a` pool + passive failover routes around the recreating replica → no
# 502. With one replica (dev default) this is a normal recreate.
rolling_recreate_api() {
  local ids id want
  ids=$($COMPOSE ps -q api 2>/dev/null || true)
  if [ -z "$ids" ]; then
    # Migration path stopped api (or first boot). Bring the set up WITH deps so
    # the `postgres-platform: service_healthy` gate (and migrate completion) is
    # honored — `--no-deps` would skip it and could boot api at a dead split DB.
    echo "🔁 api not running — starting replica set (deps + health gates)"
    $COMPOSE up -d --no-build api
    want=$($COMPOSE ps -q api 2>/dev/null | grep -c .)
    [ "$want" -ge 1 ] || want=1
  else
    want=$(printf '%s\n' "$ids" | grep -c .)
    echo "🔁 Rolling-recreating $want api replica(s) one at a time..."
    for id in $ids; do
      docker rm -f "$id" >/dev/null 2>&1 || true
      # Recreate the now-missing slot with the new image; --no-recreate leaves
      # the still-serving survivors untouched until their turn.
      $COMPOSE up -d --no-build --no-deps --no-recreate api
      if ! wait_api_healthy "$want"; then
        echo "ERROR: api pool unhealthy after recreating a replica — refilling pool, then aborting"
        # Best-effort: bring the pool back to full count so the edge isn't left
        # short even though we abort the deploy.
        $COMPOSE up -d --no-build --no-deps api || true
        return 1
      fi
    done
  fi
  wait_api_healthy "$want"
}

# Restart back-end app services in bulk, then roll the api separately.
# NEVER touch stacks-node, postgres, hiro-postgres, hiro-api.
$COMPOSE up -d --no-build --remove-orphans $APP_SERVICES_NO_API
rolling_recreate_api || { echo "ERROR: api rolling recreate failed"; exit 1; }

# Caddy's Caddyfile is bind-mounted, so `up -d` won't detect file changes
# from the git pull. Restart to pick up Caddyfile edits AND drop any cached
# TLS state from prior configs (a `reload` keeps cert cache, which can
# cause stale on-demand resolutions to outlive the config that requested
# them — bit us during the post-shared-rip Caddyfile collapse).
#
# Validate the new (bind-mounted) Caddyfile against the still-running OLD
# container FIRST — a malformed config would otherwise drop the whole API edge
# on restart. Abort the deploy and leave the current Caddy serving instead.
if docker exec secondlayer-caddy-1 caddy validate \
     --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  docker restart secondlayer-caddy-1 2>/dev/null || \
    echo "⚠️  caddy restart failed (container may be missing)"
else
  echo "ERROR: Caddyfile failed validation — leaving current Caddy config running"
  exit 1
fi

flock -u 9

# Pin .env to the SHA we just rolled to — BEFORE the health gate runs. If a
# subsequent check fails and the script exits non-zero, the containers are
# already running the new tag; .env must reflect that or a future manual
# `docker compose up -d <service>` will silently roll back to whatever .env
# still says. `record_successful_deploy()` adds the state-dir markers at
# end-of-script ONLY on full success — that's intentional, the markers track
# "last verified deploy" separately from "what's running now."
_upsert_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"
  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

pin_deploy_env() {
  local env_file="/opt/secondlayer/docker/.env"
  if [ -f "$env_file" ]; then
    _upsert_env_var "$env_file" DEPLOY_IMAGE_OWNER "$DEPLOY_IMAGE_OWNER" || true
    _upsert_env_var "$env_file" DEPLOY_IMAGE_TAG "$DEPLOY_IMAGE_TAG" || true
    echo "📌 Pinned .env to deploy tag ${DEPLOY_IMAGE_TAG} (containers running new SHA regardless of health-gate outcome)"
  fi
}

pin_deploy_env

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

# Run health probes concurrently so a slow service doesn't serialize the others.
# Each function already has its own retry/backoff. Skip the historical `sleep 5`
# warmup — the first probe attempt acts as the initial wait and falls through
# to the retry loop if the service isn't ready yet.
# api has no host port (replicas) — probe live replicas from inside the network.
wait_api_healthy &
_pid_api=$!
check_health indexer http://localhost:3700/health &
_pid_indexer=$!
check_container_health l2-decoder &
_pid_decoder=$!

_health_failed=0
wait "$_pid_api" || _health_failed=1
wait "$_pid_indexer" || _health_failed=1
wait "$_pid_decoder" || _health_failed=1
unset _pid_api _pid_indexer _pid_decoder
if [ "$_health_failed" != "0" ]; then
  echo "ERROR: one or more services failed health check"
  exit 1
fi
unset _health_failed

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

  # NOTE: `.env` is pinned earlier in `pin_deploy_env()`, immediately after
  # `docker compose up -d`. This function only writes the state-dir markers,
  # which represent "last fully-verified deploy" (different concept from
  # "what's currently running").

  echo "Recorded successful deploy state in ${DEPLOY_STATE_DIR}"
}

record_successful_deploy
