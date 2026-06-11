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
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Absolute path: `bunx sl` from a tmp dir resolves the unrelated npm package `sl`.
SL="${SL_BIN:-$REPO_ROOT/node_modules/.bin/sl}"

# name:template-slug pairs (plain list — macOS bash 3.2 lacks declare -A).
# Names are the public Explore identities (global namespace, claimed on
# first publish — first-party claims these four).
SEEDS=(
  "sbtc-flows:sbtc-flows"
  "pox-stacking:pox-stacking"
  "bns-names:bns-names"
  "sip10-balances:sip-010-balances"
)

# Definitions import @secondlayer/subgraphs; install once so deploy
# doesn't hit an interactive install prompt in the bare tmp project.
(cd "$OUT_DIR" && bun add @secondlayer/subgraphs >/dev/null 2>&1)

tip=$(curl -sf "$API_URL/v1/subgraphs" | python3 -c "import json,sys; print(json.load(sys.stdin)['tip']['block_height'])")
if [ -z "$tip" ] || [ "$tip" -le 0 ]; then
  echo "could not read chain tip from $API_URL/v1/subgraphs" >&2
  exit 1
fi

# ~5s Nakamoto blocks → ~17,280/day. Clamp at 1 for shallow chains (devnet).
blocks_back=$(( MONTHS * 30 * 17280 ))
start_block=$(( tip > blocks_back ? tip - blocks_back : 1 ))
echo "chain tip $tip → start_block $start_block (~${MONTHS}mo)"

for pair in "${SEEDS[@]}"; do
  name="${pair%%:*}"
  slug="${pair#*:}"
  file="$OUT_DIR/subgraphs/$name.ts"   # `create` writes under subgraphs/
  echo "── $name (template: $slug)"
  (cd "$OUT_DIR" && "$SL" subgraphs create "$name" --template "$slug" >/dev/null)
  # Managed deploys default public — deploy alone lists it on Explore.
  "$SL" subgraphs deploy "$file" --start-block "$start_block" -y
done

echo
echo "Seeded. Verify: curl $API_URL/v1/subgraphs | jq '.subgraphs[].name'"
echo "Explore page: https://secondlayer.tools/subgraphs/explore"
