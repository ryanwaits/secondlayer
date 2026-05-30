# Design spike: chain-anchored proofs for Streams

Status: **exploratory** (no build commitment). Decision requested: build / no-build.

## Why

Streams responses are signed with **ed25519** (`X-Signature`, opt-in SDK
`verify`). That proves **origin authenticity** — "Secondlayer produced these exact
bytes" — but not that the data is **genuinely on-chain**. A malicious or buggy
Secondlayer could sign fabricated events and a verifying client would accept
them. A *chain-anchored* proof would let a client verify, **without trusting
Secondlayer**, that an event really occurred in the canonical Stacks chain
anchored to Bitcoin's proof-of-work. This doc scopes what that would take.

## Trust models, weakest → strongest

1. **Origin auth (today, ed25519).** Trust Secondlayer's key. Detects tampering
   in transit and forgery by third parties; does *not* detect Secondlayer itself
   serving bad data.
2. **Tx-inclusion proof.** Prove the *transaction* an event came from is in a
   canonical Stacks block, and that block is anchored to a Bitcoin block on the
   PoW chain. Client still trusts our event *extraction* from that tx.
3. **Event-inclusion proof.** Prove the *event* itself is a consensus-attested
   side effect. Requires either an event-level consensus commitment or client
   re-execution (see obstacle below).
4. **zk-execution proof.** A SNARK attesting the event is the correct output of
   running the proven tx. Research-grade; out of scope.

## The core obstacle

Stacks consensus commits to **transactions** (a tx Merkle root in the block
header), but **events are execution side effects** — they are not, as far as we
know, independently Merkleized into a consensus root. Consequence: you can prove
a *tx* is in a block, but to prove an *event* you must either

- **re-execute** the tx in a client-side Clarity VM to re-derive its events, or
- rely on a (currently nonexistent / unverified) event-level commitment.

So a true event-level "on-chain proof" reduces to **tx-inclusion proof +
client-side re-execution**. That re-execution is the expensive, novel part.

> Open question O1: does Nakamoto expose any event/receipt Merkle root or
> signer-attested execution commitment that would avoid re-execution? Verify
> against the Stacks consensus spec before costing anything beyond tx-inclusion.

## What a tx-inclusion proof needs (Option A, the realistic floor)

A proof bundle per event/tx:

1. **Event → tx**: trivial (the event already carries `tx_id`); the trust gap is
   our decoding, which Option A does not close.
2. **Tx → Stacks block header**: a Merkle path from `tx_id` to the block's tx
   Merkle root. _Open question O2: does a Stacks node / Hiro API expose tx Merkle
   proofs? If not, we'd compute them from full blocks ourselves._
3. **Stacks block → burn (Bitcoin) block**: the block header carries its burn
   anchor; in Nakamoto, tenures are tied to burn blocks and block headers are
   signed by the **stacker signer set**. Verifying this step needs the signer set
   public keys + their signatures (O3).
4. **Burn block → Bitcoin PoW**: a Bitcoin **SPV** proof — a chain of Bitcoin
   block headers from a client-trusted checkpoint to the anchoring block, plus a
   Merkle proof of the block-commit transaction. This is the security root.

Client-side this means: a Bitcoin header sync/checkpoint, Merkle verification,
and (for step 3) signer-set signature verification — a substantial SDK surface.

## SDK surface impact

- A `verify: { mode: "chain", bitcoinCheckpoint }` option that, per response,
  fetches a proof bundle and verifies steps 2–4.
- New client deps: Bitcoin header handling + SPV Merkle verify; Stacks
  signer-set verification; for event-level (Option B) a Clarity interpreter.
- New server endpoints: proof-bundle generation (Merkle paths, header ranges),
  likely a Bitcoin-header feed or checkpoint service.

Roughly: Option A (tx-inclusion) is a **large** but bounded build. Option B
(event-level via re-execution) is a **major** undertaking (client Clarity VM,
determinism guarantees). Option D (zk) is research.

## Cost / complexity

| Option | Server | Client | Closes |
|---|---|---|---|
| A — tx-inclusion + SPV | Proof bundles, header feed | SPV + Merkle + signer verify | tx is canonical & PoW-anchored (not our decoding) |
| B — + re-execution | A + tx bytes/state access | A + Clarity VM | full event authenticity |
| D — zk execution | Proving infra | SNARK verify | full, succinct — research |

## Recommendation

**No-build now.** ed25519 origin auth is the right *practical* trust model for
the current consumers, and the highest-value chain proof (event-level) is blocked
on either client re-execution (Option B, major) or an event-level consensus
commitment that may not exist (O1).

If/when a concrete high-assurance consumer appears (a bridge, an L2 settlement
layer, a dispute system), the **minimal next step is a tx-inclusion SPV spike
(Option A)**: resolve O1–O3, prototype a proof bundle for one tx, and verify it
end-to-end against a Bitcoin checkpoint. Only pursue event-level (B) if that
consumer specifically needs side-effect-level assurance.

## Open questions

- **O1** — Does Nakamoto expose an event/receipt Merkle root or signer-attested
  execution commitment (would avoid client re-execution)?
- **O2** — Do Stacks nodes / Hiro APIs serve tx Merkle proofs, or must we derive
  them from full blocks?
- **O3** — Are stacker signer-set public keys + per-block signatures retrievable
  for client-side header verification?
- **O4** — Is there a real consumer today that ed25519 origin auth does *not*
  satisfy? (Drives whether any of this is worth building.)
