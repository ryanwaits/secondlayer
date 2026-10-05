#!/usr/bin/env bash
# Render the workload-host cloud-init YAML to stdout. Shared by `provision.sh`
# (real host) and `spike/045-containment/run.sh` (scratch VM) so both boot an
# identical host. Prints YAML only; creates nothing.
#
# Usage: docker/workload-host/render-cloud-init.sh <app_server_ip>
#
# Two renders, in order:
#   1. `docker-user-egress.sh` is inlined verbatim at the placeholder line
#      (`__DOCKER_USER_EGRESS_SCRIPT__`) in cloud-init.yaml — the standalone
#      file is the ONE source of truth for the firewall rules, so the two can
#      never drift. The placeholder's own indentation is preserved (read off
#      the placeholder line itself) so the inlined script stays valid under
#      the YAML block scalar; each line is copied verbatim underneath it.
#   2. `__APP_SERVER_IP__` is baked into the runcmd line that invokes the
#      egress script (cloud-init has no other way to receive a value at
#      create time without a secrets store this host doesn't have yet).

set -euo pipefail

APP_SERVER_IP="${1:?usage: render-cloud-init.sh <app_server_ip>}"
SCRIPT_DIR="$(dirname "$0")"

awk -v script_file="$SCRIPT_DIR/docker-user-egress.sh" '
	/__DOCKER_USER_EGRESS_SCRIPT__/ {
		match($0, /^[ \t]*/)
		indent = substr($0, RSTART, RLENGTH)
		while ((getline line < script_file) > 0) {
			print indent line
		}
		close(script_file)
		next
	}
	{ print }
' "$SCRIPT_DIR/cloud-init.yaml" | sed "s/__APP_SERVER_IP__/${APP_SERVER_IP%/*}/"
