# Secondlayer reference Clarity contracts

## `spv-adapter`

A thin, read-only wrapper that exposes the **SIP-044 (Clarity 6) Bitcoin SPV
built-ins** (`get-bitcoin-tx-output?`, `verify-merkle-proof`) — which are only
callable from within a Clarity contract — over read-only RPC, so the
`@secondlayer/stacks/bitcoin` `bitcoinVerifier` (and any integrator) can reach
them. No state, no admin, no custody.

Functions: `get-tx-output`, `verify-merkle`, `header-merkle-root`,
`was-tx-mined` (the composed, header-authenticated check), plus `reverse-buff32`.

### Status: Clarity 6 / Epoch 4.0 — runs in Clarinet simnet

The built-ins do not exist on mainnet/testnet until Stacks Epoch 4.0 activates,
but **Clarinet ≥ 3.21 boots simnet at Epoch 4.0**, so it both type-checks and
*executes* them locally — no node, no `clarity-cli` build.

### Run locally

```bash
# Type-check (resolves the SIP-044 built-ins at Clarity 6).
clarinet check

# Exercise a built-in in the REPL (genesis coinbase, vout 0 → 50 BTC).
echo '(contract-call? .spv-adapter get-tx-output 0x<genesis-coinbase-hex> u0)' \
  | clarinet console
```

The `@secondlayer/stacks` test suite drives the adapter through
`@stacks/clarinet-sdk` simnet and asserts the built-ins accept the exact args the
SDK encodes — runs in plain `bun test`, in CI. See
`packages/stacks/src/bitcoin/__tests__/onchain.simnet.test.ts`.

`was-tx-mined`'s header-authentication branch calls `get-burn-block-info?
header-hash`. simnet *does* record a header-hash per burn block (so the lookup
resolves and the `ERR-BAD-HEADER` path is tested), but its burn headers are
synthetic — the authenticated `(ok ...)` path needs a real 80-byte BTC header and
is exercised on a devnet / mainnet at Epoch 4.0. The pure built-ins
(`verify-merkle-proof`, `get-bitcoin-tx-output?`) and `header-merkle-root` are
fully exercised in simnet.
