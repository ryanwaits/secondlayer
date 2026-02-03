#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="/Volumes/stacks-node/stacks-data"
ARCHIVE_FILE="/Volumes/stacks-node/mainnet-stacks-blockchain-latest.tar.gz"
ARCHIVE_URL="https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.tar.gz"
SHASUM_URL="https://archive.hiro.so/mainnet/stacks-blockchain/mainnet-stacks-blockchain-latest.sha256"

# Check external drive is mounted
if [ ! -d "/Volumes/stacks-node" ]; then
  echo "Error: /Volumes/stacks-node not mounted. Plug in the external drive."
  exit 1
fi

echo "=== Stacks Mainnet Snapshot Download ==="
echo "Target: $DATA_DIR"
echo "Archive: ~321GB compressed"
echo ""

# Step 1: Download archive (--continue-at - resumes interrupted downloads)
echo "Downloading archive..."
curl --continue-at - --retry 10 --retry-delay 5 --retry-max-time 0 \
  --progress-bar \
  --output "$ARCHIVE_FILE" \
  -L "$ARCHIVE_URL"

# Step 2: Verify checksum
echo "Verifying checksum..."
curl -sL "$SHASUM_URL" -o "${ARCHIVE_FILE}.sha256"
echo "$(cat "${ARCHIVE_FILE}.sha256" | awk '{print $1}')  ${ARCHIVE_FILE}" | shasum -a 256 -c

# Step 3: Extract
echo "Extracting to $DATA_DIR..."
mkdir -p "$DATA_DIR"
tar -zxvf "$ARCHIVE_FILE" -C "$DATA_DIR"

echo ""
echo "Extraction complete. Contents:"
ls -lh "$DATA_DIR"
du -sh "$DATA_DIR"
echo ""
echo "You can now delete the archive to reclaim ~321GB:"
echo "  rm $ARCHIVE_FILE"
echo ""
echo "Run 'docker compose up' from docker/ to start."
