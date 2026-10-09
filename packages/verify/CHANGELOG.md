# @secondlayer/verify

## 0.3.0

### Minor Changes

- 680401a: `verifyBlock` checks a block's transactions and names its writes by default.

  - verify: new `txs` link between `signatures` and `witness`: every transaction in the block body parses, and the txids hash to the header's tx merkle root (`tx-root-mismatch` otherwise). `result.transactions` holds `{ txid, raw }` per transaction. Epoch 2.x blocks, and a source that serves the header only, skip it with a note. `txMerkleRoot` and `blockTransactions` are exported.
  - verify: **new default.** The diff's writes are always named from the source's `getStateWrites` when it has any; `SecondlayerProofSource` now reads them from the free, rate-limited `/v1/proofs/writes/{height}` instead of the metered `/v1/index/state-writes`. A source with no writes for the block (404 or empty, as on the hosted API until its node delivers `state_writes`) or one that errors leaves the diff proven but unnamed with a note, never a failure. `result.writes` holds the named rows; each named `diff.writes` entry carries its proven `value`. `rows: true` now only adds the metered `vm_events` check.
  - verify: `BlockVerification` also reports the authenticated header's `blockHash`, `consensusHash` and `timestamp`.
  - cli: `secondlayer verify block` prints the `txs` line, names writes without `--rows`, and `--rows` only adds the `vm_events` check. `--json` lists transactions as txids.
  - stacks: `splitTransactions(bytes, count)` splits back-to-back serialized transactions into each one's exact bytes.

### Patch Changes

- Updated dependencies [680401a]
  - @secondlayer/stacks@6.2.0

## 0.2.0

### Minor Changes

- addfa8b: `verifyBlock` proves blocks below the checkpoint: their id is tied to it by hash (parent links within 16 blocks, else one MARF proof of `__MARF_BLOCK_HEIGHT_TO_HASH::<height>` against the checkpoint's state root), then the header (Nakamoto or epoch 2.x) must hash to that id and the witness to its root. Adds the `ancestry` step and result field, `parseEpoch2Header` and `getEpoch2Header` on both sources. `secondlayer verify block <old height>` shows an `ancestry` link in place of the Bitcoin and signer links.

## 0.1.0

### Minor Changes

- d81cbc2: First public release of `@secondlayer/verify`: `verifyBlock` and `BlockVerifier` prove a Stacks block from a baked checkpoint (Bitcoin headers, burn binding, signer set and signatures, state witness, named diff, indexed rows) over untrusted sources, `SecondlayerProofSource` (`/v1/proofs`) and `NodeRpcProofSource`. Billed Index reads (`state_writes`, `vm_events`) happen only with `rows: true`. The CLI now depends on the published package instead of bundling it.
