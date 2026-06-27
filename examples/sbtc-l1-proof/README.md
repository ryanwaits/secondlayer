# sbtc-l1-proof

Index the Stacks side, prove the Bitcoin side, verify on-chain.

For every sBTC deposit the [Secondlayer](https://secondlayer.tools) index surfaces
— each row carries the `bitcoin_txid` and funding `output_index` that link a
Stacks mint to its Bitcoin L1 transaction — this example builds the Bitcoin SPV
proof and runs the **SIP-044 native built-ins** against the `spv-adapter`
reference contract. It runs **today** in Clarinet simnet (Epoch 4.0), no node.

> Requires **Clarinet ≥ 3.21** (boots simnet at Epoch 4.0, where the SIP-044
> built-ins resolve). The on-chain path is devnet/simnet-only until Stacks
> Epoch 4.0 activates on testnet/mainnet.

```bash
cd examples/sbtc-l1-proof
bun install            # resolves @secondlayer/stacks from npm (^2.9.0)
bun start              # index recent deposits → prove each
```

Output (per deposit):

```
✓ 93cab74b…d2a4f1:0
    included:  true   (verify-merkle-proof, on-chain)
    btc out:   12000 sats → bc1ptezyg6shfw95yc0v7v0fhumkqcvvhw3lcgve7lmvjnfd7hna7rusushdc2
    sbtc mint: 11753 sats  (fee 247 sats)
```

## The pieces

| File | Does |
| --- | --- |
| `deposits.ts` | Pulls recent deposits (`bitcoin_txid` + `output_index`) from `/v1/index/sbtc/deposits`. Anonymous read; pinned historical deposit as fallback. |
| `simnet.ts` | Boots the `spv-adapter` contract in Clarinet simnet (Epoch 4.0) and exposes `callRO`. The SDK↔contract Clarity bridge. |
| `prove.ts` | Per deposit: `buildTxProof` (Esplora) → `verify-merkle-proof` + `get-bitcoin-tx-output?` on-chain. |
| `index.ts` | Ties it together. |

Run any piece alone: `bun run deposits` · `bun run smoke` · `bun run prove`.

## What this proves (and what it doesn't)

`verify-merkle-proof` confirms the tx is committed under the block's merkle root,
and `get-bitcoin-tx-output?` decodes the funded output — both **native built-ins,
executed on-chain in simnet**, fed by the exact bytes the SDK encodes. The BTC
output amount (12000 sats) minus the protocol fee equals the sBTC minted (11753).

It is **not yet chain-authentication**: `verify-merkle-proof` checks inclusion
under a caller-supplied root, and simnet's burn-block headers are synthetic. The
fully header-authenticated check — `was-tx-mined`, which authenticates the block
header against `get-burn-block-info?` — needs a real Bitcoin header and a live
Clarity-6 chain. At Epoch 4.0 it's a one-line upgrade: swap `callRO` for
`bitcoinVerifier` + a `PublicClient` and call `was-tx-mined` on the deployed
adapter. Same proof, same contract.

SPV trust-minimizes **verification**, not **custody**.

## Config

| Env | Default |
| --- | --- |
| `SL_API_URL` | `https://api.secondlayer.tools` |
| `ESPLORA_URL` | `https://blockstream.info/api` |
