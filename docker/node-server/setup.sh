#!/usr/bin/env bash
# Provision a dedicated node server (Hetzner AX102) for bitcoind + stacks-node.
#
# Usage: bash docker/node-server/setup.sh
#
# Prerequisites:
#   - Fresh Ubuntu 24.04
#   - 2x NVMe drives (nvme0n1 = Bitcoin, nvme1n1 = Stacks)
#   - Run as root

set -euo pipefail

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "==> $*"; }
die()  { echo "FATAL: $*" >&2; exit 1; }

[[ $EUID -ne 0 ]] && die "Must run as root"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------
read -rp "App server IP (for event observer + firewall): " APP_SERVER_IP
[[ -z "$APP_SERVER_IP" ]] && die "APP_SERVER_IP required"

# ---------------------------------------------------------------------------
# System packages
# ---------------------------------------------------------------------------
log "Installing system packages"
apt-get update -qq && apt-get upgrade -y -qq
apt-get install -y -qq \
  ca-certificates curl gnupg lsb-release \
  fail2ban ufw git parted jq

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------
if ! command -v docker &>/dev/null; then
  log "Installing Docker"
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
else
  log "Docker already installed"
fi

# ---------------------------------------------------------------------------
# Firewall
# ---------------------------------------------------------------------------
log "Configuring UFW"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 8333/tcp                          # Bitcoin P2P
ufw allow 20444/tcp                         # Stacks P2P
ufw allow from "$APP_SERVER_IP" to any port 20443  # Stacks RPC (app server only)
ufw --force enable
log "UFW enabled (22, 8333, 20444, 20443 from $APP_SERVER_IP)"

# ---------------------------------------------------------------------------
# fail2ban
# ---------------------------------------------------------------------------
systemctl enable --now fail2ban
log "fail2ban active"

# ---------------------------------------------------------------------------
# Partition drives
# ---------------------------------------------------------------------------
setup_drive() {
  local dev="$1" mount="$2" label="$3"

  if mountpoint -q "$mount"; then
    log "$mount already mounted, skipping"
    return
  fi

  if [ ! -b "$dev" ]; then
    die "$dev not found — expected NVMe drive for $label at $mount"
  fi

  log "Formatting $dev as $label → $mount"
  parted -s "$dev" mklabel gpt
  parted -s "$dev" mkpart primary ext4 0% 100%

  # Wait for partition device
  sleep 2
  local part="${dev}p1"
  [ -b "$part" ] || part="${dev}1"
  [ -b "$part" ] || die "Partition device not found for $dev"

  mkfs.ext4 -L "$label" "$part"
  mkdir -p "$mount"
  mount "$part" "$mount"

  # Add to fstab if not already there
  if ! grep -q "$mount" /etc/fstab; then
    echo "LABEL=$label $mount ext4 defaults,noatime 0 2" >> /etc/fstab
  fi
}

setup_drive /dev/nvme0n1 /data/bitcoin bitcoin-data
setup_drive /dev/nvme1n1 /data/stacks  stacks-data

# ---------------------------------------------------------------------------
# Generate credentials
# ---------------------------------------------------------------------------
BITCOIN_RPC_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
log "Generated Bitcoin RPC password"

# ---------------------------------------------------------------------------
# Write .env
# ---------------------------------------------------------------------------
cat > "$SCRIPT_DIR/.env" <<EOF
COMPOSE_PROJECT_NAME=secondlayer
BITCOIN_DATA_DIR=/data/bitcoin
STACKS_DATA_DIR=/data/stacks
BITCOIN_RPC_PASSWORD=${BITCOIN_RPC_PASSWORD}
APP_SERVER_IP=${APP_SERVER_IP}
EOF
log "Wrote .env"

# ---------------------------------------------------------------------------
# Write bitcoin.conf with generated password
# ---------------------------------------------------------------------------
cat > "$SCRIPT_DIR/bitcoin.conf" <<EOF
server=1
txindex=1
disablewallet=1
dbcache=16384
rpcuser=stacks
rpcpassword=${BITCOIN_RPC_PASSWORD}
rpcallowip=127.0.0.1
rpcport=8332
port=8333
EOF
log "Wrote bitcoin.conf"

# ---------------------------------------------------------------------------
# Write Config.toml with app server IP + password
# ---------------------------------------------------------------------------
cat > "$SCRIPT_DIR/Config.toml" <<EOF
[node]
working_dir = "/stacks-blockchain/data"
rpc_bind = "0.0.0.0:20443"
p2p_bind = "0.0.0.0:20444"
seed = ""
bootstrap_node = "02196f005965cebe6ddc3901b7b1cc1aa7a88f305bb8c5893456b8f9a605923893@seed.mainnet.hiro.so:20444,02539449ad94e6e6392d8c1deb2b4e61f80ae2a18964349bc14336d8b903c46a8c@cet.stacksnodes.org:20444,02ececc8ce79b8adf813f13a0255f8ae58d4357309ba0cedd523d9f1a306fcfb79@sgt.stacksnodes.org:20444,0303144ba518fe7a0fb56a8a7d488f950307a4330f146e1e1458fc63fb33defe96@est.stacksnodes.org:20444"

[[events_observer]]
endpoint = "${APP_SERVER_IP}:3700"
events_keys = ["*"]
timeout_ms = 30000
disable_retries = false

[burnchain]
chain = "bitcoin"
mode = "mainnet"
peer_host = "bitcoind"
username = "stacks"
password = "${BITCOIN_RPC_PASSWORD}"
rpc_port = 8332
peer_port = 8333
EOF
log "Wrote Config.toml"

# ---------------------------------------------------------------------------
# Systemd service
# ---------------------------------------------------------------------------
cat > /etc/systemd/system/secondlayer-node.service <<EOF
[Unit]
Description=Second Layer Node (bitcoind + stacks-node)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${SCRIPT_DIR}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable secondlayer-node
log "Systemd service installed"

# ---------------------------------------------------------------------------
# Start bitcoind (IBD begins)
# ---------------------------------------------------------------------------
log "Starting bitcoind (Initial Block Download begins)"
cd "$SCRIPT_DIR"
docker compose up -d bitcoind

echo ""
log "Setup complete!"
echo ""
echo "Bitcoin IBD is running. Monitor with:"
echo "  docker exec secondlayer-bitcoind-1 bitcoin-cli -rpcuser=stacks -rpcpassword=${BITCOIN_RPC_PASSWORD} getblockchaininfo"
echo ""
echo "After Bitcoin syncs past block 666050, start stacks-node:"
echo "  cd ${SCRIPT_DIR} && docker compose up -d stacks-node"
echo ""
echo "App server firewall: allow port 3700 from this server's IP"
echo "  ufw allow from <this-server-ip> to any port 3700"
