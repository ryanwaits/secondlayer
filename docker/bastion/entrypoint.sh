#!/bin/bash
# Bastion entrypoint:
#   1. Generate host keys on first boot (bind-mounted so they survive restart).
#   2. Ensure directories exist with correct perms.
#   3. Re-hydrate tenant users from persisted state — see tenant-add.sh.
#   4. Run sshd in the foreground so tini reaps zombies.
set -euo pipefail

STATE_DIR=/var/bastion-state
KEYS_DIR=/etc/ssh/authorized_keys.d
DROPIN_DIR=/etc/ssh/sshd_config.d

mkdir -p "$STATE_DIR/keys" "$STATE_DIR/dropins" "$KEYS_DIR" "$DROPIN_DIR"

# Host keys live under the bind-mount so clients don't see a new fingerprint
# every time the container is rebuilt.
for kt in ed25519 rsa; do
  src="$STATE_DIR/ssh_host_${kt}_key"
  if [ ! -f "$src" ]; then
    ssh-keygen -q -t "$kt" -N "" -f "$src"
  fi
  cp "$src" "/etc/ssh/ssh_host_${kt}_key"
  cp "${src}.pub" "/etc/ssh/ssh_host_${kt}_key.pub"
  chmod 600 "/etc/ssh/ssh_host_${kt}_key"
  chmod 644 "/etc/ssh/ssh_host_${kt}_key.pub"
done

# Rehydrate tenants from persisted state (keys + drop-ins + users).
# tenant-add.sh is idempotent so running it per persisted key is safe.
shopt -s nullglob
for keyfile in "$STATE_DIR"/keys/tenant-*; do
  user=$(basename "$keyfile")
  slug="${user#tenant-}"
  pubkey=$(cat "$keyfile")
  /usr/local/bin/tenant-add.sh "$slug" "$pubkey" >/dev/null || true
done

# sshd requires /run/sshd on some images.
mkdir -p /run/sshd

exec /usr/sbin/sshd -D -e
