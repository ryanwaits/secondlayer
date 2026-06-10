#!/usr/bin/env bash
# Seed the Explore directory: deploy + publish the 4 first-party template
# subgraphs with ~6 months of history.
#
# Run with your prod login active (`sl login`) or SL_API_KEY set. Idempotent:
# redeploying an unchanged definition is a no-op; visibility is preserved.
#
#   ./scripts/seed-explore.sh            # deploy all 4 against prod
#   MONTHS=3 ./scripts/seed-explore.sh   # shallower history
set -euo pipefail

API_URL="${SL_API_URL:-https://api.secondlayer.tools}"
MONTHS="${MONTHS:-6}"
OUT_DIR="$(mktemp -d /tmp/seed-explore.XXXXXX)"

# name → template slug. Names are the public Explore identities (global
# namespace, claimed on first publish — first-party claims these four).
declare -A SEEDS=(
  ["sbtc-flows"]="sbtc-flows"
  ["pox-stacking"]="pox-stacking"
  ["bns-names"]="bns-names"
  ["sip10-balances"]="sip-010-balances"
)

tip=$(curl -sf "$API_URL/v1/subgraphs" | python3 -c "import json,sys; print(json.load(sys.stdin)['tip']['block_height'])")
if [ -z "$tip" ] || [ "$tip" -le 0 ]; then
  echo "could not read chain tip from $API_URL/v1/subgraphs" >&2
  exit 1
fi

# ~5s Nakamoto blocks → ~17,280/day. Clamp at 1 for shallow chains (devnet).
blocks_back=$(( MONTHS * 30 * 17280 ))
start_block=$(( tip > blocks_back ? tip - blocks_back : 1 ))
echo "chain tip $tip → start_block $start_block (~${MONTHS}mo)"

for name in "${!SEEDS[@]}"; do
  slug="${SEEDS[$name]}"
  file="$OUT_DIR/$name.ts"
  echo "── $name (template: $slug)"
  (cd "$OUT_DIR" && bunx sl subgraphs create "$name" --template "$slug" >/dev/null)
  # Managed deploys default public — deploy alone lists it on Explore.
  bunx sl subgraphs deploy "$file" --start-block "$start_block" -y
done

echo
echo "Seeded. Verify: curl $API_URL/v1/subgraphs | jq '.subgraphs[].name'"
echo "Explore page: https://secondlayer.tools/subgraphs/explore"
