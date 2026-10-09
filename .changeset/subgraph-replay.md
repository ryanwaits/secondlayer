---
"@secondlayer/subgraphs": minor
"@secondlayer/shared": minor
"@secondlayer/sdk": minor
"@secondlayer/cli": minor
"@secondlayer/api": patch
"@secondlayer/indexer": patch
---

Recompute a state-level subgraph from proven blocks and check its served rows.

- cli: `secondlayer verify subgraph <name> --replay [--from H] [--to H]` proves every block in the range from the checkpoint, checks transactions and named writes, re-runs the served handler bundle in the deterministic realm and compares the served rows, one line per link (`pin`, `blocks`, `txs`, `inputs`, `handlers`, `rows`). Rows compare on declared columns and `_block_height`; `_tx_id` (tx attribution) is unproven and not compared. Exit `0` clean, `1` a broken link, `2` could not check (no `state_writes` on the instance, an inconclusive mid-history range, a subgraph that is not state-level).
- subgraphs: new `./verify` entry: `replaySubgraph`, `replayBlocks`, `compareRows`, `checkPin`, `replayContracts`, `loadDeterministicDefinition`.
- subgraphs: **`map_insert` sources derive level `events`.** Storage cannot tell an insert from a set; a stored `state` level updates on redeploy.
- subgraphs: a `state` subgraph reads its write events from `state_writes` once the instance holds them from its `startBlock` on (checked against the lowest `state_writes` height, cached per minute), and keeps `vm_events` otherwise. Nothing changes on an instance whose node does not deliver `state_writes`.
- subgraphs: deploys store `pin_preimage` (migration `0158`), the canonical JSON the pin hashes; `processBlock` runs through a pure `applyBlock` core shared with replay.
- shared: `decodeRawTx` moves to `@secondlayer/shared/node/tx-summary`; `pin_preimage` on subgraph rows; `IndexHttpClient.walkStateWrites` and `firstStateWriteHeight`.
- sdk: `index.stateWrites.list({ contractId, txContext })`; `SubgraphSource` carries `handlerCode`, `pin` and `pinPreimage`.
- api: `/v1/index/state-writes` takes `contract_id` and `tx_context`; free, rate-limited `GET /v1/proofs/writes/{height}`; `/api/subgraphs/:name/source` returns the handler bundle and pin preimage.
- indexer: imports `decodeRawTx` from shared.
