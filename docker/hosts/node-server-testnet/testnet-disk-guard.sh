#!/usr/bin/env bash
# Protect the mainnet bitcoind that shares /home: stop the testnet node
# project when the disk fills.
set -uo pipefail
USED=$(df --output=pcent /home | tail -1 | tr -dc '0-9')
[ -n "$USED" ] || exit 0
if [ "$USED" -ge 85 ]; then
  echo "testnet-disk-guard: /home at ${USED}%, stopping secondlayer-testnet"
  docker compose -p secondlayer-testnet stop
fi
