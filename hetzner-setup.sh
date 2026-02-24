#!/bin/bash
# Hetzner AX52 Server Setup for Second Layer
# Usage: ssh root@<server-ip> 'bash -s' < hetzner-setup.sh
# Or:    DOMAIN=api.example.com ssh root@<server-ip> 'bash -s' < hetzner-setup.sh
set -euo pipefail

REPO_DIR="/opt/secondlayer"
REPO_URL="https://github.com/secondlayer-labs/secondlayer.git"

# Use GITHUB_TOKEN for private repos
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  REPO_URL="https://${GITHUB_TOKEN}@github.com/secondlayer-labs/secondlayer.git"
fi

# Ensure git is available
command -v git &>/dev/null || { apt-get update -qq && apt-get install -y -qq git; }

# Clone or update repo
if [[ -d "$REPO_DIR/.git" ]]; then
  cd "$REPO_DIR" && git pull
else
  git clone "$REPO_URL" "$REPO_DIR"
fi

# Hand off to bootstrap (Phase 0 handles Docker, UFW, etc.)
exec bash "$REPO_DIR/docker/scripts/bootstrap.sh" "$@"
