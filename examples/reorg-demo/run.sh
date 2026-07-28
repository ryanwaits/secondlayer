#!/usr/bin/env bash
# Boot the fake chain, wait for it, run the demo, clean up.
#   ./run.sh              — the demo
#   SHOW_WIRE=1 ./run.sh  — plus the cursor sequence on the wire
set -euo pipefail
cd "$(dirname "$0")"

: "${DATABASE_URL:=postgresql://postgres:postgres@127.0.0.1:5440/secondlayer}"
export DATABASE_URL
PORT="${PORT:-8899}"
export PORT

bun run fake-index.ts >/tmp/reorg-demo-chain.log 2>&1 &
CHAIN_PID=$!
trap 'kill "$CHAIN_PID" 2>/dev/null || true' EXIT

ready=0
for _ in $(seq 1 50); do
	if curl -sf "http://127.0.0.1:${PORT}/" -o /dev/null 2>&1; then ready=1; break; fi
	sleep 0.1
done

# Never fail silently on a black screen: a busy port is the likeliest cause.
if [ "$ready" -ne 1 ]; then
	echo "fake chain did not come up on port ${PORT} after 5s:" >&2
	cat /tmp/reorg-demo-chain.log >&2
	echo "(if the port is busy, rerun with PORT=8900 ./run.sh)" >&2
	exit 1
fi

if [ "${SHOW_WIRE:-0}" = "1" ]; then
	tail -f /tmp/reorg-demo-chain.log &
	TAIL_PID=$!
	trap 'kill "$CHAIN_PID" "$TAIL_PID" 2>/dev/null || true' EXIT
else
	clear
fi

bun run demo.ts
