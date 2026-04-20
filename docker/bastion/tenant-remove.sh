#!/bin/bash
# Remove a tenant's bastion credentials.
#
# Usage: tenant-remove.sh <slug>
#
# Idempotent — missing files are not an error.
set -euo pipefail

SLUG="${1:?slug required}"
USER="tenant-$SLUG"
STATE_DIR=/var/bastion-state
KEYS_DIR=/etc/ssh/authorized_keys.d
DROPIN_DIR=/etc/ssh/sshd_config.d

rm -f "$STATE_DIR/keys/$USER" "$STATE_DIR/dropins/$USER.conf"
rm -f "$KEYS_DIR/$USER" "$DROPIN_DIR/$USER.conf"

if id "$USER" >/dev/null 2>&1; then
  deluser "$USER" >/dev/null 2>&1 || true
fi

if pgrep -x sshd >/dev/null 2>&1; then
  pkill -HUP -x sshd || true
fi

echo "removed $USER"
