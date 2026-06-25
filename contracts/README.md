# Secondlayer reference Clarity contracts

## `spv-adapter`

A thin, read-only wrapper that exposes the **SIP-044 (Clarity 6) Bitcoin SPV
built-ins** (`get-bitcoin-tx-output?`, `verify-merkle-proof`) — which are only
callable from within a Clarity contract — over read-only RPC, so the
`@secondlayer/stacks/bitcoin` `bitcoinVerifier` (and any integrator) can reach
them. No state, no admin, no custody.

Functions: `get-tx-output`, `verify-merkle`, `header-merkle-root`,
`was-tx-mined` (the composed, header-authenticated check), plus `reverse-buff32`.

### Status: gated on Clarity 6 / Epoch 4.0

The built-ins do not exist on mainnet/testnet until Stacks Epoch 4.0 activates.
Released **Clarinet (≤ 3.20) cannot run this** (it caps at Clarity 3 / Epoch 3.2).
Drive it instead with `clarity-cli` built from a Clarity-6 stacks-core branch.

### Run locally with `clarity-cli`

```bash
# 1. Build clarity-cli from a Clarity-6 stacks-core branch (~5-15 min, no node).
#    Confirm the current SIP-044 branch first — branches move.
git clone --branch pox-wf-integration --depth 1 https://github.com/stacks-network/stacks-core
cd stacks-core && cargo build --release -p clarity-cli
CLI=$PWD/target/release/clarity-cli

# 2. Boot an Epoch 4.0 VM and deploy the adapter.
$CLI initialize --epoch 4.0 ./db
ADDR=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
$CLI launch --epoch 4.0 --clarity-version clarity6 \
  $ADDR.spv-adapter <path-to>/contracts/spv-adapter.clar ./db

# 3. Exercise a built-in directly (genesis coinbase, vout 0 → 50 BTC).
echo "(get-bitcoin-tx-output? 0x<genesis-coinbase-hex> u0)" | \
  $CLI eval-at-chaintip $ADDR.spv-adapter ./db
```

The `@secondlayer/stacks` test suite has an env-gated integration test
(`SPV_CLARITY_CLI=<path-to-clarity-cli>`) that does all of the above and asserts
the built-ins accept the args the SDK encodes. See
`packages/stacks/src/bitcoin/__tests__/onchain.integration.test.ts`.

`was-tx-mined`'s header-authentication branch calls `get-burn-block-info?
header-hash`, which needs real burn-block data — it is exercised on a devnet /
mainnet at Epoch 4.0, not in the isolated `clarity-cli` VM (where it returns the
not-authentic error). The pure built-ins (`verify-merkle-proof`,
`get-bitcoin-tx-output?`) and `header-merkle-root` are fully exercised locally.
