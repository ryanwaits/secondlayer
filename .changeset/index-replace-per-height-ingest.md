---
"@secondlayer/indexer": minor
---

Ingest replaces transactions/events per block height. The `new_block` handler now deletes existing `transactions`/`events` at the block height before re-inserting (extracted into a testable `persistBlock()`), so a reorged height no longer accumulates orphaned duplicate `(block_height, tx_index)` rows — the upstream cause of the Streams cursor collisions that wedged the L2 decoders (#46). The cursor-dedupe in `writeDecodedEvents` stays as defense-in-depth.
