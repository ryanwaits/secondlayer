---
"@secondlayer/shared": patch
"@secondlayer/indexer": patch
"@secondlayer/subgraphs": patch
"@secondlayer/api": patch
"@secondlayer/bitcoin": patch
---

Indexer state fixes. Observer journal receipts move through guarded transitions with `poisoned` and `skipped` states; one backlog query feeds `/health/integrity` and the applier. Failed contract ABI fetches retry with backoff up to five attempts (`contracts.abi_attempts`, `abi_next_attempt_at`). Fork repairs run the full reorg cascade under the apply lock, and reorgs lower `highest_seen_block`. `resolveChainTip` is the one chain-tip resolver, and `STACKS_NETWORK` is the one network variable (`NETWORK` still works, with a deprecation log). The archive pointer is promoted with a conditional write, late mempool announcements for confirmed transactions are ignored, and Runes batch backfill writes undo rows for its last blocks.
