# Secondlayer reference Clarity contracts

## `spv-adapter`

A thin, read-only wrapper that exposes the **SIP-044 (Clarity 6) Bitcoin SPV
built-ins** (`get-bitcoin-tx-output?`, `verify-merkle-proof`) — which are only
callable from within a Clarity contract — over read-only RPC, so the
`@secondlayer/stacks/bitcoin` `bitcoinVerifier` (and any integrator) can reach
them. No state, no admin, no custody.

Functions: `get-tx-output`, `verify-merkle`, `header-merkle-root`,
`was-tx-mined` (the composed, header-authenticated check), plus `reverse-buff32`.

`verify-merkle` is membership only — it proves the leaf sits under the supplied
root, but does **not** authenticate that root against the chain. Use
`was-tx-mined` for the full check: it authenticates a caller-supplied 80-byte
header against the chain's record at `height` (`get-burn-block-info?
header-hash`), extracts the committed merkle root, and proves inclusion under it
— atomically.

### `was-tx-mined` return values

| Result | Meaning |
| --- | --- |
| `(ok true)` | header is canonical AND the tx is included (mined) |
| `(ok false)` | header is canonical but the tx is not included |
| `(err u1)` `ERR_BAD_HEADER` | header is not the canonical block at `height` |
| `(err u2)` `ERR_BAD_SLICE` | merkle-root slice failed (malformed header length) |

`height` is the **Bitcoin/burn** block height. `(err u1)` means the supplied
header is not the canonical block the node recorded at `height` — a wrong or
reorged header, or `height` out of range: before the Stacks chain launched, or
newer than the node's last-processed burn block (a very recent tx — wait for the
node to catch up). `get-burn-block-info? header-hash` is indexed by burn height,
so "flash blocks" (a BTC block that produced no Stacks block) are covered, not a
gap.

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
resolves and the `ERR_BAD_HEADER` path is tested), but its burn headers are
synthetic — the authenticated `(ok ...)` path needs a real 80-byte BTC header and
is exercised on a devnet / mainnet at Epoch 4.0. The pure built-ins
(`verify-merkle-proof`, `get-bitcoin-tx-output?`) and `header-merkle-root` are
fully exercised in simnet.

### Deploy (at Epoch 4.0) — one-command recipe, gated until activation

> **Blocked until Clarity 6 / Epoch 4.0 is live on the target network.** The
> contract references the SIP-044 built-ins; `clarinet` analysis rejects it on a
> pre-4.0 testnet/mainnet. Do not run `apply` before activation. (simnet is the
> exception — it boots at 4.0.)

**Founder decision first:** the deployer principal + contract name is a new,
irreversible on-chain identity (e.g. `SP….spv-adapter`). Reuse an existing
secondlayer deployer or mint a dedicated key — decide before applying to mainnet.

1. Create the network settings with the deployer mnemonic (these are
   **gitignored** — they hold secrets; encrypt rather than leaving plaintext):

   ```bash
   cp settings/Devnet.toml settings/Testnet.toml   # then set the real mnemonic + node url
   clarinet deployments encrypt                     # encrypt the mnemonic at rest
   ```

2. Generate the deployment plan (writes `deployments/` — also gitignored):

   ```bash
   clarinet deployments generate --testnet --low-cost   # or --mainnet
   ```

3. Apply it:

   ```bash
   clarinet deployments apply --testnet                 # or --mainnet (founder sign-off)
   ```

4. Record the deployed principal as the default. Drop it into
   `packages/stacks/src/bitcoin/constants.ts` → `SPV_ADAPTER_CONTRACTS` so
   `verifyBitcoinPayment` resolves it automatically when `contract` is omitted:

   ```ts
   export const SPV_ADAPTER_CONTRACTS = {
     testnet: { address: "ST…", name: "spv-adapter" },
     mainnet: { address: "SP…", name: "spv-adapter" },
   };
   ```

5. Smoke-test end-to-end: point `bitcoinVerifier` at the deployed adapter and
   verify a golden proof (`was-tx-mined` against a real BTC header).
