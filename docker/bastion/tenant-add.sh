#!/bin/bash
# Add or update a tenant's bastion credentials.
#
# Usage: tenant-add.sh <slug> "<ssh-pubkey line>"
#
# Creates Unix user `tenant-<slug>`, writes the authorized_keys file and
# the per-tenant sshd_config drop-in, then signals sshd to reload.
# Idempotent — safe to rerun with a rotated pubkey.
set -euo pipefail

SLUG="${1:?slug required}"
PUBKEY="${2:?pubkey required}"

# Conservative slug validation — must match pgContainerName() expectations.
if ! [[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]]; then
  echo "Invalid slug: $SLUG" >&2
  exit 2
fi

USER="tenant-$SLUG"
STATE_DIR=/var/bastion-state
KEYS_DIR=/etc/ssh/authorized_keys.d
DROPIN_DIR=/etc/ssh/sshd_config.d

# Persisted copies (survive container restart).
mkdir -p "$STATE_DIR/keys" "$STATE_DIR/dropins"
printf '%s\n' "$PUBKEY" > "$STATE_DIR/keys/$USER"
chmod 600 "$STATE_DIR/keys/$USER"

# Runtime copy consumed by sshd (AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u).
mkdir -p "$KEYS_DIR"
cp "$STATE_DIR/keys/$USER" "$KEYS_DIR/$USER"
chmod 644 "$KEYS_DIR/$USER"

# Ensure the phantom Unix user exists — sshd still needs one to bind auth to.
# /sbin/nologin prevents any interactive shell; the drop-in below blocks even
# exec/TTY channels.
if ! id "$USER" >/dev/null 2>&1; then
  adduser -D -H -s /sbin/nologin "$USER"
fi

# Per-tenant sshd drop-in: only allow TCP forwarding to this tenant's pg.
DROPIN_RUNTIME="$DROPIN_DIR/$USER.conf"
DROPIN_STATE="$STATE_DIR/dropins/$USER.conf"

cat > "$DROPIN_STATE" <<EOF
Match User $USER
  AllowTcpForwarding yes
  PermitOpen sl-pg-$SLUG:5432
  PermitTTY no
  X11Forwarding no
  AllowAgentForwarding no
  ForceCommand echo "This bastion is for port forwarding only. Use ssh -L."; exit 0
EOF

cp "$DROPIN_STATE" "$DROPIN_RUNTIME"
chmod 644 "$DROPIN_RUNTIME"

# Reload sshd so Match blocks take effect for new connections.
if pgrep -x sshd >/dev/null 2>&1; then
  pkill -HUP -x sshd || true
fi

echo "added $USER (sl-pg-$SLUG:5432)"
