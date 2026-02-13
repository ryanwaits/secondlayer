#!/usr/bin/env bash
# Download Hiro API Postgres archive dump for self-hosted backfill.
#
# Usage: bash docker/scripts/download-hiro-archive.sh [DATA_DIR]
#
# Downloads the latest mainnet PG dump from archive.hiro.so (~40GB compressed).
# Supports resume via curl --continue-at -.

set -euo pipefail

DATA_DIR="${1:-${DATA_DIR:-/opt/secondlayer/data}}"
DUMP_DIR="${DATA_DIR}/hiro-pg-dump"
ARCHIVE_BASE="https://archive.hiro.so/mainnet/stacks-blockchain-api-pg"

echo "==> Checking archive listing..."
LATEST=$(curl -sL "${ARCHIVE_BASE}/" | grep -oP 'stacks-blockchain-api-pg-\d+-\d+\.\d+\.\d+-postgres-\d+' | sort -V | tail -1)

if [ -z "$LATEST" ]; then
  echo "ERROR: Could not detect latest archive. Check ${ARCHIVE_BASE}/ manually."
  echo "Download the .dump file and place it at: ${DUMP_DIR}/hiro-api.dump"
  exit 1
fi

DUMP_URL="${ARCHIVE_BASE}/${LATEST}/${LATEST}.dump"
CHECKSUM_URL="${ARCHIVE_BASE}/${LATEST}/${LATEST}.sha256"

mkdir -p "$DUMP_DIR"
DUMP_FILE="${DUMP_DIR}/hiro-api.dump"

echo "==> Archive: ${LATEST}"
echo "==> Downloading to: ${DUMP_FILE}"
echo "==> URL: ${DUMP_URL}"
echo ""

# Download with resume support
curl --continue-at - -L -o "$DUMP_FILE" "$DUMP_URL"

# Verify checksum if available
echo ""
echo "==> Verifying checksum..."
EXPECTED=$(curl -sL "$CHECKSUM_URL" 2>/dev/null | awk '{print $1}')
if [ -n "$EXPECTED" ]; then
  ACTUAL=$(sha256sum "$DUMP_FILE" 2>/dev/null || shasum -a 256 "$DUMP_FILE" | awk '{print $1}')
  ACTUAL=$(echo "$ACTUAL" | awk '{print $1}')
  if [ "$EXPECTED" = "$ACTUAL" ]; then
    echo "    Checksum OK"
  else
    echo "    WARNING: Checksum mismatch!"
    echo "    Expected: ${EXPECTED}"
    echo "    Actual:   ${ACTUAL}"
  fi
else
  echo "    No checksum file found, skipping verification"
fi

echo ""
echo "==> Download complete: ${DUMP_FILE}"
echo ""
echo "Next step — restore into hiro-postgres:"
echo ""
echo "  pg_restore --host localhost --port 5433 --username postgres \\"
echo "    --jobs 4 --dbname stacks_blockchain_api \\"
echo "    --no-owner --no-privileges \\"
echo "    ${DUMP_FILE}"
