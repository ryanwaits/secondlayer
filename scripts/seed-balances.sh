#!/usr/bin/env bash
# Seed the curated balance subgraphs (sBTC / USDCx / ALEX) under the
# genesis-exempt founder account. Balances are only correct from genesis,
# so this MUST run with an account allowed full-history backfill.
#
# Usage: SL_API_KEY=sk-sl_... ./scripts/seed-balances.sh
set -euo pipefail
cd "$(dirname "$0")/.."

API="${SL_API_URL:-https://api.secondlayer.tools}"

verify_asset() { # contract_id — abort if the Index has never seen it
  local contract="$1"
  local count
  count=$(curl -sf "$API/v1/index/events?event_type=ft_transfer&contract_id=$contract&limit=1" \
    | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('events',[])))")
  if [ "$count" -lt 1 ]; then
    echo "✗ no ft_transfer events for $contract — check the contract id before seeding" >&2
    exit 1
  fi
  echo "✓ $contract has indexed transfers"
}

verify_asset "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token"
verify_asset "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx"
verify_asset "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.age000-governance-token"

for f in scripts/seed-balances/*.ts; do
  name=$(basename "$f" .ts)
  echo "── deploying $name (genesis backfill — expect a long initial sync)"
  bunx sl subgraphs deploy "$f" --start-block 1
  bunx sl subgraphs publish "$name" || true   # public by default; belt+braces
done

echo "Done. Listings appear on /subgraphs/explore once synced."
