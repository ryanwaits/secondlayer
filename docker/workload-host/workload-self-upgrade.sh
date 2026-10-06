#!/usr/bin/env bash
# Moves the workload host's own checkout to the commit app-server reports as
# deployed, rebuilds, restarts `secondlayer-workload`, and rolls back if the
# new process doesn't come up healthy. Runs from OUTSIDE the service being
# replaced (systemd timer, see secondlayer-workload-upgrade.timer).
#
# Tenant stacks are upgraded separately by the service itself
# (packages/workload/src/upgrade.ts); this only covers the service's code and
# the tenant compose file it reads from the same checkout.
#
# Flow: target sha = app-server GET /health image_sha; current = checkout
# HEAD. Equal -> no-op. Dirty tree -> refuse. If nothing the service depends
# on changed, just move HEAD (no restart). Otherwise install, build, restart,
# then poll /healthz until it reports the target sha. Any failure after
# checkout restores the previous sha and records the target in
# $WORKLOAD_STATE_DIR/bad-sha so it isn't retried until a newer sha is
# deployed.
#
# Usage (normally via the timer):
#   docker/workload-host/workload-self-upgrade.sh
#
# Overridable via env (defaults are the production layout):
#   WORKLOAD_CHECKOUT_DIR     /opt/secondlayer-workload/src
#   WORKLOAD_ENV_FILE         /opt/secondlayer-workload/workload.env
#                             (APP_SERVER_URL, GATEWAY_PORT are read from it
#                             unless already set in the environment)
#   WORKLOAD_STATE_DIR        /var/lib/secondlayer-workload
#   WORKLOAD_UPGRADE_LOCK     /run/secondlayer-workload-upgrade.lock
#   WORKLOAD_HEALTH_URL       http://127.0.0.1:${GATEWAY_PORT:-8080}/healthz
#   WORKLOAD_HEALTH_TIMEOUT   60 (seconds)
#
# Clear a recorded bad sha: rm $WORKLOAD_STATE_DIR/bad-sha

set -euo pipefail

export PATH="$PATH:/root/.bun/bin"

CHECKOUT="${WORKLOAD_CHECKOUT_DIR:-/opt/secondlayer-workload/src}"
ENV_FILE="${WORKLOAD_ENV_FILE:-/opt/secondlayer-workload/workload.env}"
STATE_DIR="${WORKLOAD_STATE_DIR:-/var/lib/secondlayer-workload}"
LOCK_FILE="${WORKLOAD_UPGRADE_LOCK:-/run/secondlayer-workload-upgrade.lock}"
HEALTH_TIMEOUT="${WORKLOAD_HEALTH_TIMEOUT:-60}"
BAD_SHA_FILE="$STATE_DIR/bad-sha"
SERVICE="secondlayer-workload"
# Paths the running service depends on; a diff outside these needs no restart.
RELEVANT_PATHS=(packages/workload packages/platform packages/shared packages/stacks docker/workload package.json bun.lock)

log() { echo "workload-self-upgrade: $*"; }

git() { command git -C "$CHECKOUT" "$@"; }

# Read one KEY=value line from the env file without sourcing it (it is a
# systemd EnvironmentFile, not guaranteed to be shell-safe).
env_file_value() {
	[ -f "$ENV_FILE" ] || return 0
	sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# Checkout, install, build, restart. Returns non-zero on the first failure
# (callers run it in an `if`, where `set -e` does not apply, hence the `&&`s).
apply_sha() {
	git checkout --quiet "$1" &&
		(cd "$CHECKOUT" && bun install --frozen-lockfile &&
			bun run build:stacks && bun run build:shared && bun run build:platform) &&
		systemctl restart "$SERVICE"
}

# Poll /healthz until it reports sha $1, up to HEALTH_TIMEOUT seconds.
wait_healthy() {
	local deadline=$((SECONDS + HEALTH_TIMEOUT)) body
	while [ "$SECONDS" -lt "$deadline" ]; do
		body=$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)
		if [[ "$body" == *"\"sha\":\"$1\""* ]]; then
			return 0
		fi
		sleep 1
	done
	return 1
}

# Everything runs inside main() so bash has parsed the whole script before the
# first checkout: this file lives in the checkout it is about to move.
main() {
	exec 9>"$LOCK_FILE"
	if ! flock -n 9; then
		log "another run is in progress, skipping"
		return 0
	fi

	APP_SERVER_URL="${APP_SERVER_URL:-$(env_file_value APP_SERVER_URL)}"
	GATEWAY_PORT="${GATEWAY_PORT:-$(env_file_value GATEWAY_PORT)}"
	HEALTH_URL="${WORKLOAD_HEALTH_URL:-http://127.0.0.1:${GATEWAY_PORT:-8080}/healthz}"
	if [ -z "$APP_SERVER_URL" ]; then
		log "APP_SERVER_URL is not set (env or $ENV_FILE)"
		return 1
	fi

	local target current changed
	target=$(curl -fsS "$APP_SERVER_URL/health" 2>/dev/null |
		sed -n 's/.*"image_sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1) || true
	if ! [[ "$target" =~ ^[0-9a-f]{40}$ ]]; then
		log "no valid image_sha from $APP_SERVER_URL/health, skipping"
		return 0
	fi

	current=$(git rev-parse HEAD)
	if [ "$current" = "$target" ]; then
		return 0
	fi

	if [ -f "$BAD_SHA_FILE" ] && [ "$(cat "$BAD_SHA_FILE")" = "$target" ]; then
		log "skipping $target (previously failed, see $BAD_SHA_FILE)"
		return 0
	fi

	if [ -n "$(git status --porcelain)" ]; then
		log "refusing to upgrade: $CHECKOUT has local changes"
		return 1
	fi

	git fetch --quiet origin
	if ! git cat-file -e "$target^{commit}" 2>/dev/null; then
		log "target $target not found after fetch, skipping"
		return 0
	fi

	changed=$(git diff --name-only "$current" "$target" -- "${RELEVANT_PATHS[@]}")
	if [ -z "$changed" ]; then
		git checkout --quiet "$target"
		log "$current -> $target (no service changes, no restart)"
		return 0
	fi

	log "upgrading $current -> $target"
	if apply_sha "$target" && wait_healthy "$target"; then
		rm -f "$BAD_SHA_FILE"
		log "upgraded to $target"
		return 0
	fi

	log "upgrade to $target failed, rolling back to $current"
	mkdir -p "$STATE_DIR"
	echo "$target" >"$BAD_SHA_FILE"
	if apply_sha "$current" && wait_healthy "$current"; then
		log "ROLLED BACK $target -> $current"
	else
		log "ROLLED BACK $target -> $current (previous sha did not report healthy either, check journalctl -u $SERVICE)"
	fi
	return 1
}

main "$@"
exit $?
