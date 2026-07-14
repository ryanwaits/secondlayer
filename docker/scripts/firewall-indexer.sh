#!/usr/bin/env bash
# Source-restrict the published indexer port to the Stacks node + the internal
# docker network.
#
# Why this exists: the indexer's ingest endpoints (/new_block, /new_burn_block,
# /new_mempool_tx, ...) have no application-layer auth — they trust the node's
# event-observer delivery. Docker publishes the port on 0.0.0.0 AND bypasses UFW
# (Docker manages the iptables FORWARD chain directly, so UFW's INPUT rules never
# apply to container traffic). Without this, the ingest API is reachable — and
# writable — from the public internet.
#
# DOCKER-USER is the one chain Docker guarantees it will not overwrite, so the
# drop lives there. Docker recreates DOCKER-USER *empty* when the daemon starts,
# so this is re-applied on boot by secondlayer-firewall.service (After=docker).
#
# Idempotent: deletes any existing copies, then re-inserts in the correct order.
set -uo pipefail

PORT="${INDEXER_PORT:-3700}"
DOCKER_NET="${INDEXER_DOCKER_NET:-172.18.0.0/16}"

# Single source of truth: derive the allowed node IP from STACKS_NODE_RPC_URL
# (e.g. http://37.27.171.220:20443 -> 37.27.171.220) so it can't drift from the
# host the indexer actually talks to. INDEXER_ALLOW_IP overrides; static default
# is the last resort.
NODE_IP="${INDEXER_ALLOW_IP:-}"
if [ -z "$NODE_IP" ] && [ -n "${STACKS_NODE_RPC_URL:-}" ]; then
	NODE_IP="$(printf '%s' "$STACKS_NODE_RPC_URL" | sed -E 's#^https?://([^:/]+).*#\1#')"
fi
NODE_IP="${NODE_IP:-37.27.171.220}"

iptables -D DOCKER-USER -p tcp --dport "$PORT" -s "$NODE_IP" -j RETURN 2>/dev/null || true
iptables -D DOCKER-USER -p tcp --dport "$PORT" -s "$DOCKER_NET" -j RETURN 2>/dev/null || true
iptables -D DOCKER-USER -p tcp --dport "$PORT" -j DROP 2>/dev/null || true

iptables -I DOCKER-USER 1 -p tcp --dport "$PORT" -j DROP
iptables -I DOCKER-USER 1 -p tcp --dport "$PORT" -s "$DOCKER_NET" -j RETURN
iptables -I DOCKER-USER 1 -p tcp --dport "$PORT" -s "$NODE_IP" -j RETURN

echo "firewall-indexer: port $PORT restricted to $NODE_IP + $DOCKER_NET"
