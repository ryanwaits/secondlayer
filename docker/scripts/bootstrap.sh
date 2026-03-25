#!/bin/bash
# Zero-to-indexed bootstrap for Second Layer on Hetzner AX52 (or any Docker host).
#
# Usage: bash docker/scripts/bootstrap.sh [--skip-provision] [--data-dir /path]
#
# Phases:
#   0. Provision (system packages, Docker, UFW, fail2ban, systemd)
#   1. Pre-flight checks
#   2. Core services (postgres, migrate, api, indexer, worker, subgraph-processor)
#   3. Caddy
#   4. Print status
#
# Note: stacks-node + bitcoind run on a separate node server.
# See docker/node-server/setup.sh for node provisioning.

set -euo pipefail

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
SKIP_PROVISION=false
DATA_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-provision) SKIP_PROVISION=true; shift ;;
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Resolve working directory — must run from docker/
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$DOCKER_DIR/.." && pwd)"
cd "$DOCKER_DIR"

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.hetzner.yml"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "==> $*"; }
warn() { echo "WARNING: $*" >&2; }
die()  { echo "FATAL: $*" >&2; exit 1; }

wait_healthy() {
  local svc="$1" max="${2:-60}"
  log "Waiting for $svc to be healthy..."
  for i in $(seq 1 "$max"); do
    status=$($COMPOSE ps "$svc" --format '{{.Status}}' 2>/dev/null || true)
    if echo "$status" | grep -qi "healthy"; then return 0; fi
    sleep 2
  done
  die "$svc did not become healthy after $((max * 2))s"
}

# ---------------------------------------------------------------------------
# Phase 0: Provision (system packages, Docker, firewall, systemd)
# ---------------------------------------------------------------------------
if [ "$SKIP_PROVISION" = true ]; then
  log "Phase 0: Skipping provisioning (--skip-provision)"
elif command -v docker &>/dev/null; then
  log "Phase 0: Docker already installed, skipping provisioning"
else
  log "Phase 0: Provisioning system"

  [[ $EUID -ne 0 ]] && die "Phase 0 requires root"

  # System packages
  apt-get update -qq && apt-get upgrade -y -qq
  apt-get install -y -qq \
    ca-certificates curl gnupg lsb-release \
    mdadm fail2ban ufw git jq

  # Docker (official repo)
  install -m 0755 -d /etc/apt/keyrings
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO="$ID"
  else
    DISTRO="debian"
  fi
  rm -f /etc/apt/sources.list.d/docker.list
  curl -fsSL "https://download.docker.com/linux/${DISTRO}/gpg" | gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/${DISTRO} $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker

  # Fix DNS for containers (systemd-resolved uses 127.0.0.53 which fails inside containers)
  mkdir -p /etc/docker
  if [ -f /etc/docker/daemon.json ]; then
    jq '. + {"dns": ["8.8.8.8", "1.1.1.1"]}' /etc/docker/daemon.json > /tmp/daemon.json && mv /tmp/daemon.json /etc/docker/daemon.json
  else
    echo '{"dns": ["8.8.8.8", "1.1.1.1"]}' > /etc/docker/daemon.json
  fi
  systemctl restart docker

  log "Docker installed"

  # Firewall
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
  log "UFW enabled (22, 80, 443)"
  log "NOTE: After provisioning node server, run: ufw allow from <node-ip> to any port 3700"

  # fail2ban
  systemctl enable --now fail2ban
  log "fail2ban active"

  # Data directories
  mkdir -p /opt/secondlayer/data/postgres /opt/secondlayer/data/subgraphs

  # Generate .env if not exists
  if [ ! -f "$DOCKER_DIR/.env" ]; then
    PG_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
    cat > "$DOCKER_DIR/.env" <<ENVEOF
COMPOSE_PROJECT_NAME=secondlayer
POSTGRES_USER=secondlayer
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=secondlayer
POSTGRES_PORT=127.0.0.1:5432
API_PORT=127.0.0.1:3800
INDEXER_PORT=0.0.0.0:3700
DOMAIN=${DOMAIN:-api.secondlayer.tools}
LOG_LEVEL=info
WORKER_CONCURRENCY=10
WORKER_REPLICAS=1
NETWORKS=mainnet
DATA_DIR=/opt/secondlayer/data
ENVEOF
    log "Generated .env (password: ${PG_PASS})"
  fi

  # Systemd service
  cat > /etc/systemd/system/secondlayer.service <<SVCEOF
[Unit]
Description=Second Layer
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${REPO_DIR}/docker
ExecStart=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.hetzner.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.yml -f docker-compose.hetzner.yml down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
SVCEOF
  systemctl daemon-reload
  systemctl enable secondlayer
  log "Systemd service installed"

  log "Phase 0 complete"
fi

# ---------------------------------------------------------------------------
# Phase 1: Pre-flight
# ---------------------------------------------------------------------------
log "Phase 1: Pre-flight checks"

command -v docker >/dev/null 2>&1 || die "docker not found"
docker compose version >/dev/null 2>&1 || die "docker compose not found"

# .env
if [ ! -f .env ]; then
  if [ -f .env.hetzner.example ]; then
    cp .env.hetzner.example .env
    die ".env created from .env.hetzner.example — edit it and re-run"
  else
    die ".env not found"
  fi
fi

# Source .env
set -a
# shellcheck disable=SC1091
source .env
set +a

# Override DATA_DIR if passed via flag
if [ -n "$DATA_DIR" ]; then
  export DATA_DIR
fi
DATA_DIR="${DATA_DIR:-/opt/secondlayer/data}"

# Disk space check (need >200GB free)
AVAIL_KB=$(df --output=avail "$DATA_DIR" 2>/dev/null | tail -1 || df -k "$DATA_DIR" | tail -1 | awk '{print $4}')
AVAIL_GB=$((AVAIL_KB / 1024 / 1024))
if [ "$AVAIL_GB" -lt 200 ]; then
  warn "$DATA_DIR has only ${AVAIL_GB}GB free (need >200GB)"
fi

log "DATA_DIR=$DATA_DIR (${AVAIL_GB}GB free)"

# ---------------------------------------------------------------------------
# Phase 2: Core services
# ---------------------------------------------------------------------------
log "Phase 2: Starting core services"

$COMPOSE up -d postgres
wait_healthy postgres

$COMPOSE up migrate
$COMPOSE up -d api indexer worker subgraph-processor

wait_healthy api
wait_healthy indexer
log "Core services healthy"

# ---------------------------------------------------------------------------
# Phase 3: Caddy
# ---------------------------------------------------------------------------
log "Phase 3: Starting caddy"

$COMPOSE up -d caddy

# ---------------------------------------------------------------------------
# Phase 4: Status
# ---------------------------------------------------------------------------
echo ""
log "Bootstrap complete"
echo ""
echo "Services:"
$COMPOSE ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
echo ""
echo "Monitor:"
echo "  curl -s localhost:3700/health | jq .     # indexer health"
echo "  curl -s localhost:3800/health | jq .     # api health"
echo ""
echo "Next: provision node server (bitcoind + stacks-node)"
echo "  See docker/node-server/setup.sh"
