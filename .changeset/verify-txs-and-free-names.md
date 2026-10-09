---
"@secondlayer/verify": minor
"@secondlayer/cli": minor
"@secondlayer/stacks": minor
---

`verifyBlock` checks a block's transactions and names its writes by default.

- verify: new `txs` link between `signatures` and `witness`: every transaction in the block body parses, and the txids hash to the header's tx merkle root (`tx-root-mismatch` otherwise). `result.transactions` holds `{ txid, raw }` per transaction. Epoch 2.x blocks, and a source that serves the header only, skip it with a note. `txMerkleRoot` and `blockTransactions` are exported.
- verify: **new default.** The diff's writes are always named from the source's `getStateWrites` when it has any; `SecondlayerProofSource` now reads them from the free, rate-limited `/v1/proofs/writes/{height}` instead of the metered `/v1/index/state-writes`. A source with no writes for the block (404 or empty, as on the hosted API until its node delivers `state_writes`) or one that errors leaves the diff proven but unnamed with a note, never a failure. `result.writes` holds the named rows; each named `diff.writes` entry carries its proven `value`. `rows: true` now only adds the metered `vm_events` check.
- cli: `secondlayer verify block` prints the `txs` line, names writes without `--rows`, and `--rows` only adds the `vm_events` check. `--json` lists transactions as txids.
- stacks: `splitTransactions(bytes, count)` splits back-to-back serialized transactions into each one's exact bytes.
