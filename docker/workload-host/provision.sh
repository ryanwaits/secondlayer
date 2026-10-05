#!/usr/bin/env bash
# Idempotent provision of the workload-host (plan 044, step 1): Hetzner
# Cloud fsn1, one firewall, one server. Re-runnable — anyone can stand up the
# same host (build-for-everyone), and a second run against an
# already-provisioned host skips what exists rather than erroring or
# duplicating resources.
#
# No separate volume (dropped 2026-09-25): the project's volume quota is
# already used by the feeder's 4.1 TB volume, so `hcloud volume create` here
# failed with `resource_limit_exceeded` on the real run. Tenant data lives
# on the CPX32's own 160 GB local disk under `/opt/secondlayer-workload`.
# Phase 1 data (chain webhooks, no subgraph tables yet) is small; revisit a
# volume — or a bigger server type — when 046 adds subgraph tables.
#
# SPEND GATE: this script creates BILLABLE resources
# (`hcloud firewall/server create`). It must only be run after the founder
# says go for the permanent host — see plan 044's step 1. Use `--dry-run` to
# print the exact `hcloud` commands without executing them.
#
# Requires: `hcloud` CLI, context `secondlayer` active, a working token
# (never printed by this script or logged by hcloud itself).
#
# Usage:
#   docker/workload-host/provision.sh --dry-run
#   docker/workload-host/provision.sh
#
# Teardown (documented, not run by this script — see
# docs/internal/runbook/workload-host.md):
#   hcloud server delete workload-host
#   hcloud firewall delete workload-host

set -euo pipefail

DRY_RUN=false
for arg in "$@"; do
	case "$arg" in
	--dry-run) DRY_RUN=true ;;
	*)
		echo "unknown argument: $arg" >&2
		exit 1
		;;
	esac
done

# --- fixed parameters (edit here, not on the command line, so a re-run is
#     reproducible from git history alone) ---
SERVER_NAME="workload-host"
SERVER_TYPE="cpx32" # 4 vCPU / 8 GB / 160 GB disk — cpx31's successor.
# `cpx31` (the SKU the plan's executor notes named) is DEPRECATED in fsn1
# as of this script (`hcloud server-type describe cpx31` — Available: no,
# unavailable after 2025-12-31). `cpx32` is the same 4 vCPU/8GB/160GB spec,
# currently available (verified live, read-only, while writing this script).
LOCATION="fsn1"
IMAGE="ubuntu-24.04"
SSH_KEY="macbook-prod"
FIREWALL_NAME="workload-host"
# app-server's public IP (docs/internal/runbook/genesis-feeder.md's Bitcoin
# RPC allowlist entry — same host, same IP, already load-bearing elsewhere).
APP_SERVER_IP="65.21.135.94/32"
# Operator laptop, same value `stacks-feeder`'s firewall already allowlists
# for SSH (`hcloud firewall describe stacks-feeder`).
OPERATOR_IP="136.62.99.163/32"

SCRIPT_DIR="$(dirname "$0")"
CLOUD_INIT_RENDERED="$(mktemp)"
# --dry-run keeps the rendered file around (and prints its path) so it can
# be inspected/diffed without actually provisioning anything; a real run
# cleans it up on exit since `hcloud` has already consumed it by then.
if ! $DRY_RUN; then
	trap 'rm -f "$CLOUD_INIT_RENDERED"' EXIT
fi

run() {
	if $DRY_RUN; then
		printf '[dry-run] %s\n' "$*"
	else
		"$@"
	fi
}

echo "== workload-host provision (dry-run=$DRY_RUN) =="

# 1. Firewall — idempotent: skip if it already exists.
if hcloud firewall describe "$FIREWALL_NAME" >/dev/null 2>&1; then
	echo "firewall '$FIREWALL_NAME' already exists, skipping"
else
	run hcloud firewall create --name "$FIREWALL_NAME" \
		--rules-file /dev/stdin <<-EOF
		[
		  {"direction": "in", "protocol": "tcp", "port": "22", "source_ips": ["${OPERATOR_IP}"]},
		  {"direction": "in", "protocol": "tcp", "port": "443", "source_ips": ["${APP_SERVER_IP}"]}
		]
	EOF
fi

# 2. Server — idempotent: skip if it already exists. cloud-init is rendered
#    by `render-cloud-init.sh` (egress script inlined, APP_SERVER_IP baked
#    in) before it's handed to `hcloud server create`.
if hcloud server describe "$SERVER_NAME" >/dev/null 2>&1; then
	echo "server '$SERVER_NAME' already exists, skipping"
else
	"$SCRIPT_DIR/render-cloud-init.sh" "${APP_SERVER_IP%/*}" >"$CLOUD_INIT_RENDERED"
	if $DRY_RUN; then
		echo "[dry-run] rendered user-data: $CLOUD_INIT_RENDERED"
	fi
	run hcloud server create --name "$SERVER_NAME" --type "$SERVER_TYPE" \
		--image "$IMAGE" --location "$LOCATION" --ssh-key "$SSH_KEY" \
		--firewall "$FIREWALL_NAME" \
		--user-data-from-file "$CLOUD_INIT_RENDERED"
fi

echo "== done =="
echo "Next: docs/internal/runbook/workload-host.md's 'Bring-up' section"
echo "(WORKLOAD_HOST_KEY, CONTROL_DATABASE_URL, and packages/workload's env)."
