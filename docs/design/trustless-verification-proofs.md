# Trustless Verification Proofs for Secondlayer

*Phased design doc — Principal Architect draft*

---

## 1. Goal & honest scope

**Trustless verification** here means: a Secondlayer consumer can cryptographically confirm that a piece of data we serve matches Stacks Nakamoto consensus — *without trusting Secondlayer's word for it* — by checking signatures and Merkle paths against the chain's own commitments, ideally re-fetchable from any public Stacks node and anchored to Bitcoin. Today we offer none of this: our only guarantee is an ed25519 attestation (`X-Signature` over the exact response bytes) that proves *"Secondlayer asserted this,"* which is provenance, not consensus.

**The hard truth about events.** A Nakamoto block header commits to exactly two Merkle roots: `tx_merkle_root` (SHA512/256 over the block's serialized transactions) and `state_index_root` (the MARF root over all Clarity state after applying the block). **There is no events root, no receipts root, no logs bloom** — unlike Ethereum's `receiptsRoot`. The decoded events that are the *core* of our products (Streams, Index's decoded layer, Subgraphs, Subscriptions: `ft_transfer`, `nft_mint`, `stx_lock`, `print`, etc.) are **execution outputs, not consensus artifacts**. They flow from the stacks-node event-dispatcher during block *processing*, and two honest nodes agree on them only because they ran identical Clarity execution. **Therefore decoded events are NOT trustlessly provable from a header proof.** They can only be verified by (a) re-executing the transaction in a Clarity VM against verified pre-state, or (b) trusting an attestation. This document designs *around* that reality: we make provable what is genuinely provable (tx-inclusion, block canonicity, at-block state reads), and we are explicit and honest about labeling everything else attestation-only — rather than overclaiming "consensus-verified" across the board.

A second non-negotiable correction baked into every design below: **the shipped mainnet header uses `signer_signature: Vec<MessageSignature>`** — a vector of *individual recoverable ECDSA (secp256k1)* signatures, one per signer (Bitcoin-P2SH-multisig style), per SIP-025 / stacks-core 3.0.0.0.0 PR #4781. There is **no aggregate WSTS Schnorr signature on mainnet today**, despite what the SIP-021 prose and docs.stacks.co say. All verifier code targets the per-signer ECDSA recover-and-weight path.

---

## 2. The trust spectrum

Four levels, each strictly additive. The same `/proof` object carries optional fields so a consumer can stop at whatever level they need.

| Level | Guarantee | Data the API returns | SDK verify steps | Residual trust |
|---|---|---|---|---|
| **Attested** *(shipped)* | "Secondlayer's key produced these exact bytes, untampered." | `X-Signature` + `X-Signature-KeyId` headers; published SPKI key at `GET /public/streams/signing-key`. | `verifyEd25519(bytes, sig, pubkey)`. | **Full trust in Secondlayer** — that our execution/decoding/indexing is correct. Zero link to chain. |
| **Anchored** | "This tx is included in *this* Nakamoto header, and the header is self-consistent + re-fetchable from any node." | `{ block_header (raw + parsed), tx_merkle_path, tx_index, raw_tx, index_block_hash }`. | (1) recompute txid from `raw_tx` (SHA512/256); (2) walk `tx_merkle_path` to `header.tx_merkle_root`; (3) optionally re-fetch `/v3/blocks/{index_block_hash}` from an independent node and byte-compare the header. | Trust that **the header itself is canonical** (signed by the real signer set, on the canonical fork). Anchored proves inclusion *in a header*, not that the header won consensus. |
| **Consensus-verified** | "≥70% of the reward cycle's signer weight signed this header." | Above **+** `consensus: { signer_signatures, signer_set_ref, signer_signature_hash_inputs }`. | (4) compute `signer_signature_hash()` (SHA512/256 over header minus sigs); (5) for each sig, `ecrecover` pubkey; (6) match each pubkey to the cycle's reward set, enforce ascending index, reject dups; (7) sum matched weights, assert `≥ (total_weight * 7) / 10`. | Trust that **the reward set itself is canonical** and that **this fork is the Bitcoin-anchored one**. No full resync needed, but the signer set's provenance and tenure sortition are still assumed. |
| **Fully trustless** | "The tenure's sortition is committed on Bitcoin's PoW chain, and the signer set is itself chain-derived." | Above **+** `bitcoin_anchor: { block_commit_tx, btc_merkle_path, btc_header_chain }` and a MARF-proven `.pox-4` signer-set snapshot. | (8) Bitcoin SPV: verify `block_commit_tx` Merkle path into a BTC block + N-deep PoW header chain; (9) bind `consensus_hash` to that sortition; (10) MARF-verify the signer set from `.pox-4` state under a trusted header. | Only the **initial trusted checkpoint** (a known-good header or BTC anchor to bootstrap from). This is genuine light-client trust-minimization. |

Key property: **a consumer who stops at Anchored** has already removed the biggest trust jump — "trust Secondlayer's data" becomes "trust a header claim any node can corroborate." Consensus-verified and Fully-trustless are progressive hardening for consumers who need them.

---

## 3. What is provable per Secondlayer data type

| Data type | Secondlayer surface | Provable trustlessly? | How / why not |
|---|---|---|---|
| **Block (canonicity)** | Index blocks, canonical hash map | **Yes — Consensus-verified** | Verify `signer_signature` Vec via per-sig `ecrecover` against the cycle reward set, sum weights ≥70%. Header re-fetchable from `/v3/blocks`. *We don't store the header/sigs today.* |
| **Header chain integrity** | (implicit) | **Yes — Anchored+** | `block_id = Hash(consensus_hash, SHA512/256(header−sigs))`; `parent_block_id` chains each block. Walk to a known anchor. |
| **Transaction (inclusion)** | Index confirmed txs, contract-call txs | **Yes — Anchored** | Recompute txid from stored `raw_tx`, walk SHA512/256 binary Merkle path to `tx_merkle_root`. **No RPC inclusion-proof endpoint exists** — proof must be *constructed* by us from the full block, but is cheaply *recomputable* (hence verifiable, not trusted) by the client. |
| **Contract-call (that it ran)** | Index, contract calls | **Yes — Anchored** (inclusion only) | Proves the *tx ran*. Does **not** prove the result, success/abort, post-conditions, or emitted events. |
| **Decoded event** (`ft_/nft_/stx_` transfer/mint/burn, `stx_lock`, `print`) | **Streams, Index decoded layer, Datasets** | **NO — attestation-only** | **Not committed to any header root.** Provable only by (a) Clarity re-execution against verified pre-state, or (b) trusting our ed25519 attestation. This is the central honest limitation. |
| **State / data-var / map-entry / balance at block B** | (not currently served from stored data) | **Yes — Consensus-verified via MARF** | `/v2/data_var`, `/v2/map_entry`, `/v2/accounts` with `?proof=1&tip=<index_block_hash>` return a MARF `TrieMerkleProof` against `state_index_root`. **But this is a live node read, not Secondlayer's stored data.** |
| **Stacking / signer set** | Index stacking | **Split.** State path: **Yes** (MARF-prove `.pox-4` map entries). Event path: **NO** | Our stacking tables are derived from `stx_lock` *events* → attestation-only. The *same fact* is MARF-provable directly from `.pox-4` contract state — but that's a different data source than what we serve. |
| **Subgraphs / Subscriptions** | derived views + webhooks | **NO — attestation-only, weakest surface** | Inherit the events' ceiling **plus** a Secondlayer-defined transform/filter/aggregation that must itself be trusted or independently recomputed. Webhook payloads carry provenance signatures only. |
| **Aggregates / rollups / joins / completeness** | Datasets, query results | **NO** | Merkle/MARF proofs prove a *positive* (X exists / = V). Proving **absence or completeness** ("these are ALL matching events") needs the full block + re-execution. Liveness/completeness is out of scope for inclusion proofs. |
| **Mempool / pre-confirmation** | mempool endpoints | **NO** | Nothing unconfirmed is consensus-committed. Inherently attestation-only. |

---

## 4. Recommended MVP

**Build first: Anchored transaction-inclusion proofs, structured so the same endpoint upgrades to Consensus-verified with no API break.**

Rationale (the highest-leverage trust-minimization per unit effort):
- It reuses what we **already store**: `transactions.raw_tx` (full SIP-003 wire bytes) is enough to recompute every txid and rebuild the tx-merkle leaves.
- The only new chain dependency is **one `/v3/blocks/{block_id}` fetch per block**, which amortizes across every tx in that block (cache per `block_id`).
- It converts *"trust Secondlayer's data"* into *"trust a header claim any public node can corroborate"* — the single biggest jump on the spectrum.
- It is **forward-compatible**: ship the `consensus` field as optional; when we wire reward-set retrieval + secp256k1 recovery, the same proof object becomes Consensus-verified.

### API surface

```
GET /v1/index/transactions/:txid/proof
```

Response (Anchored MVP; `consensus` and `bitcoin_anchor` are optional, populated as later phases ship):

```jsonc
{
  "txid": "0x…",
  "index_block_hash": "0x…",          // recovered/persisted StacksBlockId
  "block_height": 234567,
  "tx_index": 12,
  "raw_tx": "0x…",                     // so the client recomputes the txid itself
  "block_header": {                    // parsed Nakamoto header (SIP-021 field order)
    "version": 0,
    "chain_length": 234567,
    "burn_spent": "…",
    "consensus_hash": "0x… (20B)",
    "parent_block_id": "0x… (32B)",
    "tx_merkle_root": "0x… (32B)",
    "state_index_root": "0x… (32B)",
    "timestamp": 1733000000,
    "miner_signature": "0x… (65B)",
    "pox_treatment": "0x… (bitvec)",
    "raw_header": "0x…"                // exact bytes to re-derive block_id / re-fetch
  },
  "tx_merkle_path": [                  // SHA512/256 binary-merkle siblings, leaf→root
    { "position": "right", "hash": "0x…" },
    { "position": "left",  "hash": "0x…" }
  ],

  // ── populated in Phase 3 (Consensus-verified) ──
  "consensus": {
    "signer_signature_hash": "0x…",   // SHA512/256 over header MINUS signer_signature
    "signer_signatures": ["0x… (65B recoverable ECDSA)", "…"],
    "signer_set_ref": { "reward_cycle": 98, "source": "/v2/stacker_set/98" },
    "threshold_numerator": 7, "threshold_denominator": 10
  },

  // ── populated in Phase 4 (Fully trustless) ──
  "bitcoin_anchor": {
    "block_commit_txid": "…",
    "btc_block_hash": "…",
    "btc_merkle_path": ["…"],
    "btc_header_chain": ["…"]          // N-deep PoW headers
  }
}
```

The whole object is wrapped in the **existing ed25519 attestation envelope** (`X-Signature`), so Attested and Anchored coexist: the envelope proves we sent it; the proof body lets the client discard that trust.

### SDK verify function shape

```ts
// @secondlayer/stacks
type VerifyLevel = "anchored" | "consensus" | "trustless";

interface VerifyResult {
  level: VerifyLevel;          // highest level actually verified
  txidMatches: boolean;        // recomputed txid === :txid
  includedInHeader: boolean;   // merkle path → tx_merkle_root
  headerSelfConsistent: boolean;
  signerWeightBps?: number;    // basis points of signer weight that signed
  thresholdMet?: boolean;      // signerWeightBps >= 7000
  bitcoinAnchored?: boolean;
  errors: string[];
}

async function verifyTransactionProof(
  proof: TransactionProof,
  opts?: {
    level?: VerifyLevel;              // default "anchored"
    rewardSet?: SignerSet;            // required for "consensus"; else fetched
    corroborateNodeUrl?: string;      // optional independent re-fetch of header
    bitcoinHeaderClient?: BtcSpvClient; // required for "trustless"
  }
): Promise<VerifyResult>;
```

Verify pipeline (Anchored): `recomputeTxid(raw_tx) === txid` → `merkleVerify(txid, tx_merkle_path, header.tx_merkle_root)` → (optional) re-fetch header by `index_block_hash`, byte-compare. Consensus adds: `signerSignatureHash(header)` → per-sig `secp256k1Recover` → match to `rewardSet`, ascending-index + dedup → sum weights ≥ 70%. **The SDK re-verifies; it never trusts a `threshold_met` boolean we computed** (trustlessness requires the client to recompute).

---

## 5. What stays attestation-only — and the long path to prove it

**Decoded events stay attestation-only.** Restating the root cause plainly: Stacks headers commit to `tx_merkle_root` (the tx ran) and `state_index_root` (the resulting MARF state), but **never to the emitted event list**. A tx-inclusion proof tells you a transaction executed; it tells you *nothing* about which `print`/`ft_transfer`/`stx_lock` events that execution produced. We ingest these events *pre-decoded from the node observer* and never re-derive them (`packages/indexer/src/parser.ts` only decodes `raw_tx` for tx-type/sender/contract metadata). So "this event fired" is, structurally, re-execution-or-trust. Subgraphs and Subscriptions sit one rung lower still: even a hypothetically-proven raw event wouldn't cover our filter/aggregate/transform logic, which a skeptic must independently recompute.

Two longer-term paths to actually prove events, in increasing cost/maturity:

1. **Clarity re-execution service (feasible, near-term-ish).** Ship a "light bundle" per event: the verified header, the tx-inclusion proof, the raw tx bytes, **and** MARF proofs of the relevant *pre-state* keys. A consumer (or our own shadow re-executor) replays the tx in a Clarity VM (`clarity-wasm` / Clarinet) against that proven pre-state and observes the emitted events deterministically. The hard part is **completeness of the pre-state**: you must MARF-prove *every* state key the tx reads, which is not known a priori without tracing execution. An intermediate offering short of full trustlessness: publish a **deterministic re-execution transcript** that a skeptical consumer can spot-check, rather than blindly attest. Cost: full per-tx re-execution is heavy; a shadow indexer that replays against MARF is the realistic engineering shape.

2. **zk proof of Clarity VM execution (research, not buildable today).** Prove the event emission inside a zk circuit. **No zk-Clarity prover exists** as of mid-2026 — general zkVMs (R0VM 2.0, SP1, Valida, Pico) prove RISC-V/WASM traces but there is no Clarity-specific circuit, and proving would require arithmetizing the Clarity interpreter (or Clarity→WASM in a WASM zkVM) *plus* the MARF reads/writes. Large research effort; track, don't commit.

The honest near-term product framing: offer a **verifiable subset** — Anchored tx-inclusion + Consensus block canonicity + MARF state reads as genuinely provable — and **explicitly label all decoded-event / subgraph / dataset rows as attestation-only**, rather than implying consensus verification we cannot deliver.

---

## 6. Build plan

### What we already have (codebase inventory)
- **`raw_tx` persisted** for every confirmed tx (`transactions.raw_tx`, `transactions_archive.raw_tx`, `mempool_transactions.raw_tx`) + `raw_result` — the bytes to recompute txids and tx-merkle leaves.
- **TS tx wire-serialization + Sha512Trunc256 txid hashing** (`packages/stacks/src/transactions/` — `signer.ts`, `authorization.ts`, `wire/serialize.ts`).
- **Native node RPC client** `StacksNodeClient` (`packages/shared/src/node/client.ts`, default `:20443`) already hitting `/v2/info`, `/v2/blocks`, `/v2/contracts/*`; `BlockResponse` already carries `index_block_hash`.
- **`index_block_hash` / `parent_index_block_hash` arrive in the ingest payload** (`NewBlockPayload`) and live in `chain_reorgs` — but are **dropped at persist** from the `blocks` row.
- **ed25519 attestation infra** (`packages/shared/src/crypto/ed25519.ts`, `packages/api/src/streams/signing.ts`, `/public/streams/signing-key`) to wrap any proof in an envelope.
- **Stable row coordinates** (`DecodedEventsTable.cursor`, `tx_id`, `tx_index`, `block_height`, `event_index`) to pin served rows to a `(block, tx, event)` a proof targets.

### Gaps / new node data needed
- **`/v3/blocks/{block_id}`** — full signed Nakamoto header (`signer_signature` Vec + `pox_treatment` bitvec) + all txs in wire format. Source for both the header and the tx-merkle path.
- **`/v2/stacker_set/{cycle}`** (and/or `/v3/signer/{pubkey}/{cycle}`) — per-cycle signer set + reward-slot weights, to check the 70% threshold.
- **`/v2/{data_var,map_entry,contracts/source}?proof=1&tip=<block_id>`** — MARF proofs for the state-read path (`getMapEntry` currently omits `?proof=1`; `getAccountInfo` fetches but never *verifies*).
- **No node endpoint returns a tx-inclusion proof** — we *construct* the SHA512/256 binary-merkle path ourselves from the full block.

### Phases

| Phase | Scope | New work | Effort | Risk |
|---|---|---|---|---|
| **P0 — Persist anchors** | One migration: persist `index_block_hash` (+ optionally `parent_index_block_hash`) on `blocks`; backfill historical rows from node `/v2/blocks` (or Hiro). | DB migration + backfill script (pattern exists: `backfill-raw-tx.ts`). | **S** | **Low.** Pure additive column + backfill. |
| **P1 — Header fetch + parser** | `StacksNodeClient.getNakamotoBlock(block_id)` → fetch `/v3/blocks`, parse header in exact SIP-021 field order, derive `block_id`, expose `raw_header`. Validate parse against real mainnet blocks. | New node method + header struct parser in `packages/shared/src/node/`. | **M** | **Med.** Must match stacks-core serialization bit-for-bit; verify `block_id = Hash(consensus_hash, SHA512/256(header−sigs))` against live data. |
| **P2 — Anchored MVP** | `buildInclusionProof(txid)`: rebuild SHA512/256 tx-merkle tree from block txs, emit path; `GET /v1/index/transactions/:txid/proof`; **per-`block_id` proof cache** so header+tree amortize. SDK `verifyTransactionProof(level:"anchored")`. | New API route, merkle builder, SDK verify path + TS merkle/txid verifier. | **M** | **Med.** Risk #1: exact `tx_merkle_root` leaf rule (txid vs raw bytes, concat order) — must reproduce against a real mainnet block before shipping. |
| **P3 — Consensus-verified** | Add `consensus` field: fetch reward set per cycle, implement `signer_signature_hash()` + per-sig `secp256k1Recover` + ascending-index/dedup + weight-sum ≥70%. SDK `level:"consensus"` re-verifies (no trusting our boolean). | secp256k1 recovery loop, reward-set client, `compute_voting_weight_threshold` port. | **L** | **Med-High.** Must target **Vec<MessageSignature> per-signer ECDSA**, not WSTS. Reward-set bootstrap trust (see Q below). Confirm signed preimage against live node. |
| **P4 — MARF state-read proofs** | `getMapEntry`/`getDataVar`/`getAccountInfo` request `?proof=1` and a **client-side TS `TrieMerkleProof` verifier** (segment + shunt skip-list) against `state_index_root`. Enables provable stacking/sBTC/BNS *state* (not events). | Port stacks-core `TrieMerkleProof` to TS (none exists anywhere). | **L–XL** | **High.** No standalone MARF verifier exists in any language outside Rust; format/cost must be reverse-engineered or the Rust ported exactly. |
| **P5 — Fully trustless (Bitcoin SPV)** | `bitcoin_anchor`: bind `consensus_hash` to a Bitcoin block-commit tx via BTC Merkle proof + N-deep PoW header chain (lean on `clarity-bitcoin` patterns). MARF-derive the signer set from `.pox-4`. | BTC SPV client (or wrap `bitcoin-tx-proof`), sortition binding. | **XL** | **High.** Hardest, least-packaged part; sortition/fork-choice validation. |
| **P6 — Event re-execution (optional, separate track)** | "Light bundle" + Clarity re-exec / re-exec transcript for events. | Shadow re-executor, pre-state MARF collection. | **XL** | **High.** Pre-state completeness is the open problem; or a spot-checkable transcript as the intermediate. |

**Recommended cut line for v1: P0 → P3.** That ships Anchored + Consensus-verified for tx-inclusion and block canonicity — real, honest, no-overclaim trust-minimization — while P4–P6 (MARF state, Bitcoin SPV, event re-exec) follow as hardening tracks.

---

## 7. Open questions to resolve before committing

1. **Product line: where does the MVP sit?** Recommendation is Anchored (P2) shipping with a forward-compatible proof object; founder confirms vs jumping to Consensus-verified (P3) on day one.
2. **Scope of the claim: events or not?** Is verifiable **tx-inclusion + state-read** sufficient for the product's trust claims, accepting that decoded events stay explicitly attestation-only? Or is event provability (P6, heavy) in scope for v1?
3. **Live-node confirmation (blocks all verifier code).** Against the *current pinned mainnet node version*, confirm: (a) header is still `Vec<MessageSignature>` per-signer ECDSA, not re-enabled WSTS; (b) the exact `signer_signature_hash` preimage and field order; (c) the exact `tx_merkle_root` leaf-hashing + concat rule — reproduce against a real mainnet block *before* writing SDK verify code.
4. **Reward-set bootstrap.** What is the canonical RPC endpoint + weight units for the per-cycle signer set, and is the set itself MARF-provable from `.pox-4` so the signer check can be bootstrapped trustlessly rather than trusting an indexer? What is the minimal trust root (checkpointed signer set vs full BTC+PoX re-derivation)?
5. **Archival / RPC reach.** Does the prod stacks-node we rely on expose `/v3/blocks` headers with full `signer_signature` vectors and `?proof=1` MARF proofs at the tips we serve, *with retained history* for past blocks consumers will query? If not, what archival node do we point proofs at?
6. **Self-contained bundle vs thin pointer.** Does Secondlayer emit a self-contained proof bundle (header + sigs + merkle path + signer-set snapshot, consumer needs no node) or a thin attestation pointing the consumer at node RPC to self-verify? (Drives proof-cache table design and payload size.)
7. **Proof-cache storage.** New `block_proofs` table (header + sigs keyed by `block_id`, amortized across the block) vs lazy fetch-and-cache? Header+sigs amortize across all txs/events in a block.
8. **Reorg / finality semantics.** Tie proof issuance to `canonical=true` + a confirmation depth (Nakamoto's no-fork-of-signed-blocks vs Bitcoin's probabilistic finality). Define behavior when a previously-proven block is later orphaned (`chain_reorgs` already tracks this). What BTC confirmation depth before "final"?
9. **MARF verifier build-vs-wrap.** Implement the `TrieMerkleProof` verifier (and signer recovery) natively in TS — *none exists in `packages/stacks` today, nor as a standalone library in any language* — or wrap stacks-core Rust (WASM)? Drives P4 effort/risk materially.
10. **Completeness/absence out of scope?** Inclusion proves a positive; "did you return ALL matching events?" needs a separate range-commitment/checkpoint scheme. Confirm that's acceptable for the framing, or scope a checkpoint scheme separately.

---

*Bottom line: build P0→P3 for honest, Bitcoin-anchorable trust-minimization on tx-inclusion and block canonicity; keep ed25519 attestation as the orthogonal provenance layer; label all decoded-event/subgraph/dataset data attestation-only and treat Clarity re-execution (P6) and zk-Clarity as the long road for events — never overclaim a receipts root Stacks does not have.*
---

## Appendix — Verified serialization (mainnet `stacks-node 3.4.0.0.3`)

Confirmed **bit-exact** against real mainnet blocks (~height 8,199,4xx, 23 signers) on our own pinned node — re-deriving each value from the raw `/v3/blocks/{id}` bytes and matching the node's own values. This is the ground truth the P1/P2 verifier code targets.

**`GET /v3/blocks/{block_id}`** — `block_id` is the `index_block_hash` hex **without** a `0x` prefix. Returns the raw `NakamotoBlock` = header ‖ `Vec<StacksTransaction>`.

**Header wire order**, fixed prefix is exactly **206 bytes**:
```
version(u8) ‖ chain_length(u64 BE) ‖ burn_spent(u64 BE) ‖ consensus_hash(20)
‖ parent_block_id(32) ‖ tx_merkle_root(32) ‖ state_index_root(32)
‖ timestamp(u64 BE) ‖ miner_signature(65)
‖ signer_signature( u32 count ‖ 65×n )
‖ pox_treatment( u16 num_bits ‖ u32 data_len ‖ data[data_len] )   // data_len = ceil(num_bits/8)
```

1. **block_hash / signer_signature_hash** = `SHA512/256( header[0:206] ‖ pox_treatment_bytes )` — the full header **omitting only `signer_signature`** (`miner_signature` and `pox_treatment` are included). ✅
2. **index_block_hash (StacksBlockId)** = `SHA512/256( block_hash ‖ consensus_hash )` — **block_hash first**. ✅
3. **tx_merkle_root** = `MerkleTree<SHA512/256>` over tx **txids**:
   - `txid = SHA512/256(raw_tx_consensus_bytes)`
   - `leaf = SHA512/256(0x00 ‖ txid)`
   - `node = SHA512/256(0x01 ‖ left ‖ right)`
   - odd level → duplicate the last node. ✅
4. **signer_signature** = `Vec<MessageSignature>` — per-signer **recoverable ECDSA (secp256k1)**, one per signer, ordered by reward-set position. Not aggregate. ✅

Gotchas that cost time and are now pinned: the `index_block_hash` preimage is `block_hash ‖ consensus_hash` (not the reverse); the `pox_treatment` BitVec carries an internal `u32` length prefix on its data vec (the 4 bytes that must be in the `block_hash` preimage); the `/v3/blocks` path id must be un-prefixed hex.

A deterministic fixture (one full block + its raw txs + expected hashes) is checked in at `packages/shared/src/node/__fixtures__/nakamoto-block.json` and exercised by `nakamoto.test.ts`.
