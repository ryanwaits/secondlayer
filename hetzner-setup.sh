#!/bin/bash
# Hetzner AX52 Server Setup for Second Layer
# Run on a fresh Ubuntu 24.04 server via SSH:
#   ssh root@<server-ip> 'bash -s' < hetzner-setup.sh
#
# Or clone the repo first and run locally:
#   git clone <repo> && cd secondlayer && bash hetzner-setup.sh

set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  Second Layer — Hetzner AX52 Setup   ${BLUE}║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════╝${NC}"
echo ""

# Must run as root
[[ $EUID -ne 0 ]] && error "Run as root"

# ──────────────────────────────────────
# 1. System updates + Docker
# ──────────────────────────────────────
info "Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

info "Installing prerequisites..."
apt-get install -y -qq \
  ca-certificates curl gnupg lsb-release \
  mdadm fail2ban ufw git

# Docker (official repo — detect Ubuntu vs Debian)
if ! command -v docker &>/dev/null; then
  info "Installing Docker..."
  install -m 0755 -d /etc/apt/keyrings

  # Detect distro
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO="$ID"
  else
    DISTRO="debian"
  fi

  # Clean up any stale Docker repo config from prior runs
  rm -f /etc/apt/sources.list.d/docker.list

  curl -fsSL "https://download.docker.com/linux/${DISTRO}/gpg" | gpg --batch --yes --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/${DISTRO} $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
  ok "Docker installed"
else
  ok "Docker already installed"
fi

# ──────────────────────────────────────
# 2. Data directories (created after clone in step 4)
# ──────────────────────────────────────

# ──────────────────────────────────────
# 3. Firewall + fail2ban
# ──────────────────────────────────────
info "Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP (Caddy)
ufw allow 443/tcp    # HTTPS (Caddy)
ufw allow 20444/tcp  # Stacks P2P
ufw --force enable
ok "UFW enabled (22, 80, 443, 20444)"

info "Configuring fail2ban..."
systemctl enable --now fail2ban
ok "fail2ban active"

# ──────────────────────────────────────
# 4. Clone repo + generate .env
# ──────────────────────────────────────
REPO_DIR="/opt/secondlayer"
REPO_URL="https://github.com/secondlayer-labs/secondlayer.git"

# Use GITHUB_TOKEN for private repos
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  REPO_URL="https://${GITHUB_TOKEN}@github.com/secondlayer-labs/secondlayer.git"
fi

if [[ -d "$REPO_DIR/.git" ]]; then
  info "Updating repo..."
  cd "$REPO_DIR" && git pull
else
  info "Cloning repo..."
  git clone "$REPO_URL" "$REPO_DIR"
  cd "$REPO_DIR"
fi

# Create data directories
mkdir -p /opt/secondlayer/data/postgres /opt/secondlayer/data/stacks-blockchain /opt/secondlayer/data/views
ok "Data directories created"

# Generate .env if not exists
if [[ ! -f docker/.env ]]; then
  PG_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
  cat > docker/.env <<EOF
POSTGRES_USER=secondlayer
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=secondlayer
POSTGRES_PORT=127.0.0.1:5432
API_PORT=127.0.0.1:3800
INDEXER_PORT=127.0.0.1:3700
DOMAIN=${DOMAIN:-api.secondlayer.tools}
LOG_LEVEL=info
WORKER_CONCURRENCY=10
WORKER_REPLICAS=1
NETWORKS=mainnet
DATA_DIR=/opt/secondlayer/data
EOF
  ok "Generated docker/.env (password auto-generated)"
  echo ""
  warn "SAVE THIS PASSWORD: ${PG_PASS}"
  echo ""
else
  ok "docker/.env already exists"
fi

# ──────────────────────────────────────
# 5. Systemd service for auto-start
# ──────────────────────────────────────
cat > /etc/systemd/system/secondlayer.service <<EOF
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
EOF

systemctl daemon-reload
systemctl enable secondlayer
ok "Systemd service installed (auto-start on boot)"

# ──────────────────────────────────────
# 6. Start services
# ──────────────────────────────────────
info "Starting Second Layer..."
cd "${REPO_DIR}/docker"
docker compose -f docker-compose.yml -f docker-compose.hetzner.yml up -d

echo ""
echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}  Setup complete!                      ${GREEN}║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
echo ""
echo "  Verify:"
echo "    docker compose -f docker-compose.yml -f docker-compose.hetzner.yml ps"
echo "    curl -s http://localhost:3700/health"
echo "    curl -s http://localhost:3800/health"
echo "    docker logs stacks-node --tail 20"
echo ""
echo "  Once DNS propagates:"
echo "    curl https://${DOMAIN:-api.secondlayer.tools}/health"
echo ""
