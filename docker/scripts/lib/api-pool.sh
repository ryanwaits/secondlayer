#!/bin/bash
# api replica pool helpers shared by deploy.sh and rollback.sh.
# Needs $COMPOSE (the compose command). api has no host port: replicas are
# probed from inside their own containers.

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
