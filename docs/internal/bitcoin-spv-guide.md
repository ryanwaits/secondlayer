# Bitcoin SPV on Stacks — `@secondlayer/stacks/bitcoin` reference

> **Status (2026-06-26): on-chain round-trip now runs in Clarinet simnet.**
> The off-chain SDK is feature + test complete and byte-validated against the
> stacks-core built-in source. The reference `spv-adapter` contract is written —
> and **Clarinet ≥ 3.21 boots simnet at Epoch 4.0**, so the SIP-044 built-ins
> now type-check AND execute locally (no node, no `clarity-cli` build). The
> SDK↔contract round-trip is proven in CI (`onchain.simnet.test.ts`, 7 tests).
> What still needs a live chain: the authenticated `was-tx-mined` happy path
> against a *real* BTC header, and testnet/mainnet deploy. All on branch
> `feat/bitcoin-spv` (not merged/pushed).

---

## 1. The shape of it

SIP-044 ("Clarity 6") gives Stacks contracts two **native** Bitcoin built-ins:

- `get-bitcoin-tx-output? (tx-bytes vout)` → `(response { script, amount, txid } uint)`
- `verify-merkle-proof (leaf root tx-index tx-count siblings)` → `bool`

paired with the **existing** `get-burn-block-info? header-hash` (authenticates a
Bitcoin block header at a height). These run **inside a Clarity contract** — there
is no RPC for them.

The SDK owns the **off-chain half** the chain can't do: fetch Bitcoin data, build
the merkle proof, handle endianness/witness, encode the Clarity args, decode the
results. Split of responsibilities:

```
 OFF-CHAIN (SDK, today)                    ON-CHAIN (built-ins, at Epoch 4.0)
 ─────────────────────                     ──────────────────────────────────
 fetch raw tx + block        ── proof ──▶  verify-merkle-proof   (membership)
 build merkle proof                        get-bitcoin-tx-output? (parse output)
 strip witness / fix bytes                 get-burn-block-info?   (authenticate header)
 encode Clarity args         ◀─ result ──  → your contract composes these
 decode { script,amount,txid }
```

The SDK reaches the built-ins through a tiny read-only **adapter contract**
(`spv-adapter`) that wraps them, since they aren't RPC-callable directly.

---

## 2. Quickstart (pseudocode — real SDK surface)

```ts
import { createPublicClient, http } from "@secondlayer/stacks";
import { mainnet } from "@secondlayer/stacks/chains";
import {
  bitcoinRpcSource, esploraSource, fallbackProofSource,
  verifyBitcoinPayment,
} from "@secondlayer/stacks/bitcoin";

const client = createPublicClient({ chain: mainnet, transport: http() });

// Trustless by default: your own Bitcoin node first, hosted fallback second.
const source = fallbackProofSource([
  bitcoinRpcSource({ url: "http://127.0.0.1:8332", auth: { username, password } }),
  esploraSource({ url: "https://blockstream.info/api" }),
]);

// "Has a real BTC payment to <addr> for <amount> been mined?"
const { verified, mined, output, proof } = await verifyBitcoinPayment(client, {
  txid:    "f4184fc5…9e16",
  source,
  vout:    0,
  contract: "SP….spv-adapter",                 // reference adapter, or your own verifier
  expect:  { address: "1A1zP1…", amount: 5_000_000_000n },
});
// verified === (mined && address matches && amount matches)
```

What `verifyBitcoinPayment` does under the hood (all real functions we built):

```
buildTxProof(source, {txid, vout})            // fetch raw tx + block, assemble proof
  ├─ parseBitcoinTx(rawTx)        → txidInternal (witness-stripped, internal order)
  ├─ buildMerkleProof(txids, i)   → { siblings, txIndex, txCount }
  └─ self-check: rootFromProof(leaf, proof) === header.merkleRoot   // reject bad source
        │
        ▼
verifier.wasTxMined(proof)                     // ONE read-only call to the adapter
  → contract: authenticate header (get-burn-block-info?) + verify-merkle-proof, atomic
        │
        ▼
parseOutputScript(output) + formatBitcoinAddress(…, network)   // decode recipient
assert expect.amount / expect.address          // → verified
```

### Gate on activation

```ts
import { isClarity6Active } from "@secondlayer/stacks/bitcoin";
// Epoch 4.0 activation height is set only after the SIP vote — pass it once known.
if (!(await isClarity6Active(client, { activationBurnHeight: HEIGHT }))) {
  // built-ins not live yet — defer / use a fallback path
}
```

---

## 3. Lower-level primitives (also shipped, all off-chain)

| Function | Purpose |
|---|---|
| `parseBitcoinTx(rawTx)` | version/inputs/outputs/locktime + `txidInternal` (legacy + SegWit) |
| `buildMerkleProof(txidsInternal, i)` | `{ siblings, txIndex, txCount }` — native shape |
| `merkleRoot` / `rootFromProof` | compute / fold a root for self-checks |
| `encodeMerkleProofArgs({leaf,root,proof})` | the exact `(leaf,root,tx-index,tx-count,siblings)` Clarity args |
| `decodeTxOutput(cv)` | `{ script, amount, txid }` from `get-bitcoin-tx-output?` |
| `parseOutputScript(script)` | P2PKH/P2WPKH/P2TR/P2SH/OP_RETURN + program bytes |
| `formatBitcoinAddress(parsed, network)` | base58/bech32/bech32m address |
| `parseBlockHeader(80B)` | version/prevBlock/**merkleRoot**/time/bits/nonce |
| `bitcoinVerifier(client,{contract})` | `.verifyMerkleProof` `.wasTxMined` `.getTxOutput` |

Everything uses **internal (raw) byte order** end-to-end — the byte order the
built-ins consume; only `reverseBytes`/`{display:true}` produce explorer form.

---

## 4. The on-chain side (the `spv-adapter` contract / your own)

A consuming contract calls the built-ins directly. The reference adapter
(`contracts/spv-adapter.clar`) is the canonical pattern:

```clarity
;; pure passthroughs
(define-read-only (get-tx-output (tx (buff 4096)) (vout uint))
  (get-bitcoin-tx-output? tx vout))

(define-read-only (verify-merkle (leaf (buff 32)) (root (buff 32))
                                 (tx-index uint) (tx-count uint)
                                 (siblings (list 24 (buff 32))))
  (verify-merkle-proof leaf root tx-index tx-count siblings))

;; composed: authenticate header → extract root → verify inclusion (atomic)
(define-read-only (was-tx-mined (header (buff 80)) (height uint) (leaf (buff 32))
                                (tx-index uint) (tx-count uint)
                                (siblings (list 24 (buff 32))))
  (let ((root (unwrap! (header-merkle-root header) ERR-BAD-SLICE)))
    (if (is-eq (get-burn-block-info? header-hash height)
               (some (reverse-buff32 (sha256 (sha256 header)))))
        (ok (verify-merkle-proof leaf root tx-index tx-count siblings))
        ERR-BAD-HEADER)))
```

A real product contract inlines this and gates a payout on `(ok true)`:

```clarity
;; pseudocode: release sBTC/NFT/loan only when the BTC payment is proven
(define-public (claim (header (buff 80)) (height uint) (rawtx (buff 4096))
                      (vout uint) (proof { … }))
  (let ((out (unwrap! (get-bitcoin-tx-output? rawtx vout) ERR))
        (mined (try! (was-tx-mined header height (get txid out) …))))
    (asserts! mined ERR-NOT-MINED)
    (asserts! (is-eq (get amount out) EXPECTED-SATS) ERR-AMOUNT)
    (asserts! (is-eq (get script out) EXPECTED-SCRIPT) ERR-RECIPIENT)
    (release-funds tx-sender)))
```

The SDK builds every argument that contract needs.

---

## 5. Run it locally (Clarinet ≥ 3.21 simnet)

No node, no devnet, no `clarity-cli`. Clarinet 3.21 boots simnet at Epoch 4.0, so
it both type-checks and *executes* the SIP-044 built-ins. The project is in
`contracts/` (manifest + `settings/Devnet.toml` committed).

```bash
clarinet --version          # need >= 3.21.0  (brew install clarinet)
cd contracts
clarinet check              # → ✔ 1 contract checked  (resolves the Clarity-6 built-ins)
clarinet console            # in-memory simnet @ Epoch 4.0
```

In the REPL (`Current epoch: 4.0`), paste one at a time:

**Parse a tx output — genesis coinbase vout 0 → 50 BTC:**
```clojure
(contract-call? .spv-adapter get-tx-output 0x01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000 u0)
;; → (ok { amount: u5000000000, script: 0x4104678afd…ac, txid: 0x3ba3edfd…4b1e5e4a })
```

**Verify a merkle proof — Block 170 (Satoshi→Hal Finney), tx index 0.**
Args `(leaf root tx-index tx-count siblings)`, hashes in **internal** byte order:
```clojure
(contract-call? .spv-adapter verify-merkle 0x82501c1178fa0b222c1f3d474ec726b832013f0a532b44bb620cce8624a5feb1 0xff104ccb05421ab93e63f8c3ce5c2c2e9dbb37de2764b3a3175c8166562cac7d u0 u2 (list 0x169e1e83e930853391bc6f35f605c6754cfead57cf8387639d3b4096c54f18f4))
;; → true   (change u0→u1 for that leaf → false)
```

**Composed header-auth check — `was-tx-mined`.** A non-canonical header
(80 zero bytes = **160 hex chars** — not 196) fails authentication:
```clojure
(contract-call? .spv-adapter was-tx-mined 0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000 u0 0x82501c1178fa0b222c1f3d474ec726b832013f0a532b44bb620cce8624a5feb1 u0 u2 (list 0x169e1e83e930853391bc6f35f605c6754cfead57cf8387639d3b4096c54f18f4))
;; → (err u1)  (ERR-BAD-HEADER)
```
> Header `(buff 80)` = exactly 160 hex digits. A `(buff 98)` error means too many
> bytes. Generate a clean zero-header: `printf '0%.0s' {1..160}`.

**Burn headers are seeded** (what `was-tx-mined`'s auth branch reads):
```clojure
(get-burn-block-info? header-hash u0)
;; → (some 0x…)   not none
```
The authenticated `(ok true)` path needs a *real* 80-byte BTC header whose hash
matches a recorded burn block — simnet's burn headers are synthetic, so that's a
devnet/mainnet test. Every other branch runs here.

**Automated (SDK-driven) version** — proves the bytes the SDK encodes are exactly
what the built-ins accept, runs in CI:
```bash
cd packages/stacks
bun test src/bitcoin/__tests__/onchain.simnet.test.ts   # → 7 pass, ~0.9s
```

---

## 6. What it unlocks

SPV trust-minimizes *verification* — a contract can prove "BTC tx T paid Z sats
to address Y in a confirmed block" without trusting an oracle or indexer.

- **Oracle-free BTC-L1 collateral** — *Zest*, *Granite*: prove a borrower's
  collateral UTXO exists on Bitcoin L1 instead of trusting a price/existence
  oracle. Liquidations and LTV checks reference proven on-chain state.
- **Atomic BTC ↔ Runes/sBTC swaps** — *Bitflow+Pontis*, *Portal*: native SPV is
  **uncapped**, so multi-output Runes/BTC txs (which blew past the old
  `clarity-bitcoin` 1024-byte / 8-output limits) now verify. Unblocks larger,
  multi-asset atomic swaps.
- **BTC-settled escrow / OTC / invoicing** — "release sBTC / an NFT / a loan only
  when a real BTC payment to addr Y for amount Z is SPV-proven" as a first-class
  contract trigger. Institutional settlement rails.
- **Trust-minimized light-client bridges** — verify Bitcoin/Ordinals/Runes events
  on-chain rather than trusting a federation; attacks the bridge-trust failures
  behind most L2 TVL loss.
- **Shrink the sBTC signer attestation role** — deposits today are *asserted* by
  the signer set observing Bitcoin; they could be *SPV-proven* on-chain, leaving
  signers responsible only for custody/liveness (aligns with SIP-028).

**Honest limit (state in any pitch):** SPV trust-minimizes *verification and
accounting*, **not custody**. You still need a signer set to *control* the pegged
BTC UTXO — Bitcoin can't enforce a Clarity rule. This is infrastructure, not
privacy; it stands apart from SilentBTC.

---

## 7. Examples to build (now vs at activation)

| Example | Builds on | Demoable |
|---|---|---|
| **sBTC deposit → Bitcoin L1 proof** | Subgraphs/Streams `sbtcDeposit` (already surfaces `bitcoin_txid`) + SDK `buildTxProof` | **now** (off-chain); verify runs in **simnet** |
| **BTC-settled escrow / OTC** | `spv-adapter.was-tx-mined` + `verifyBitcoinPayment` | **simnet now** (real-header auth at activation) |
| **BTC-L1 collateral proof** (Zest/Granite-style) | same | **simnet now** (real-header auth at activation) |
| **Atomic BTC↔sBTC/Runes swap** | uncapped native SPV (multi-output) | **simnet now** (real-header auth at activation) |
| **Proof-bundle dataset** `/v1/index/bitcoin/proofs` | indexer + a Bitcoin source (plan 014) | deferred to demand |

The first one is the keystone — and it runs **today**, because secondlayer already
indexes the correlation key:

```ts
// 1. The indexing product already gives you the Stacks→Bitcoin link.
//    on/sbtc.ts surfaces `bitcoin_txid` on every sBTC deposit/withdrawal.
import { sbtcDeposit } from "@secondlayer/stacks/on";
const spec = sbtcDeposit({ subgraph, table });   // a Subscription/Subgraph filter

// 2. For each indexed deposit event, the SDK assembles the L1 proof — today,
//    off-chain, from your own node (or Hiro fallback).
async function onDeposit(event) {                 // delivered by the subscription webhook
  const proof = await buildTxProof(source, { txid: event.bitcoin_txid, vout: 0 });

  // 3. At Epoch 4.0, the same proof verifies on-chain — no code change.
  const { mined } = await verifyBitcoinPayment(client, {
    proof, contract: "SP….spv-adapter", vout: 0,
  });
}
```

#1 is **built and runnable now** at `examples/sbtc-l1-proof/` — indexes real sBTC
deposits, builds each Bitcoin proof from Esplora, and runs the SIP-044 built-ins
against `spv-adapter` in simnet (`bun start` → `included: true` + decoded output +
fee delta). #2–#4 ship as code + `.clar` alongside the adapter at activation (so
they're tested, not untested Clarity). #5 is plan 014.

## 8. The flywheel — secondlayer indexing ⇄ SPV

SPV isn't a standalone SDK feature; it compounds with the indexing product. The
loop:

```
 Stacks-side index            Bitcoin-L1 proof              new indexed surface
 (already shipped)            (this SDK)                    (compounds)
 ───────────────────         ──────────────────           ────────────────────
 sBTC deposits/withdrawals    bitcoin_txid ─▶ buildTxProof  BTC-settled events,
 w/ bitcoin_txid, pox,    ──▶ ─▶ verifyBitcoinPayment   ──▶ proof bundles, collateral
 decoded events                (your node / Hiro)            state → richer subgraphs
        ▲                                                            │
        └──────────────── more apps → more demand ◀──────────────────┘
```

How each turn lowers the cost of the next app class:

1. **secondlayer already indexes the Stacks half.** Decoded events + `on/sbtc.ts`
   surface `bitcoin_txid` — the exact join key between a Stacks event and its
   Bitcoin L1 tx. No new indexing needed to *start*.
2. **The SDK supplies the Bitcoin half.** It turns that `bitcoin_txid` into a
   verifiable proof off-chain (integrator node first). A builder wires
   Subgraph/Streams (trigger) → SDK (proof) → contract (verify) with no node ops
   from us.
3. **Demand pulls the proof feed into the index.** When enough builders assemble
   the same proofs, per the **Index-vs-Subgraphs doctrine** ("ships a decoded-data
   primitive that makes building indexers easier for any dev → `/v1/index`"), the
   proof bundle graduates to a first-class `/v1/index/bitcoin/proofs` primitive
   (plan 014) — queryable by txid/address/height, **pre-joined to the sBTC event**.
   Now the next builder skips running a node entirely.
4. **Cheaper integration → more apps → new indexed outcomes.** BTC-settled escrow,
   collateral, and swaps emit new on-chain events worth indexing (a "BTC-settled"
   Stream, a `sbtc-flows` subgraph extension correlating deposit → L1 proof → mint,
   an agent/MCP "prove-this-payment" tool). Those become the next decoded-data
   primitives — and the loop repeats.

**Net:** secondlayer's existing index is what makes SPV easy to *adopt* (the
correlation key is already there); SPV adoption is what justifies indexing the
*next* Bitcoin-L1 layer; that new layer makes the next class of BTC-aware Stacks
app cheaper to build. The SDK is the bridge that closes the loop — and it's the
only piece that needs to exist before the indexing side can compound.

Sequencing note: nothing here forces plan 014 early. The integrator-node-first
path (steps 1–2) is the default and works today; the indexed feed (step 3) is
demand-gated, exactly as the doctrine prescribes.

## 9. Where we are / what's next

- **Done (off-chain, validated against built-in source):** the whole module above,
  60+ tests incl. live Bitcoin-data integration; `@secondlayer/stacks/bitcoin`
  exported; minor changeset; reference contract written.
- **Done (on-chain, simnet):** `spv-adapter` type-checks + executes the SIP-044
  built-ins in Clarinet ≥ 3.21 simnet; SDK↔contract round-trip proven in CI
  (`onchain.simnet.test.ts`). Recipe in `contracts/README.md` (no `clarity-cli`).
- **Still needs a live chain:** the authenticated `was-tx-mined` happy path against
  a real BTC header (simnet's burn headers are synthetic), then deploy
  `spv-adapter` testnet→mainnet at Epoch 4.0 (founder sign-off).
- **Deferred:** a secondlayer-hosted proof-bundle feed (plan 014) — only on named
  demand; integrator-node-first covers the common case today.
```
