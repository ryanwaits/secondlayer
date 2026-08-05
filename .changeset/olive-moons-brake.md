---
"@secondlayer/subgraphs": patch
---

Serialize the reindex/backfill walk against the live catch-up walk with a per-subgraph advisory lock.

`catchUpSubgraph` held a per-subgraph lock around each block it committed; `processBlockRange` — the walk behind both reindex and backfill — held nothing, so the two could interleave writes to the same rows of the same subgraph. Backfill made that routine rather than exotic: it runs at status `active`, the exact status the live walk selects on, and never changes it, so catch-up had no reason to stand down. `ctx.increment` survived the overlap on its own (the flush retries a lost `INSERT` race), but read-modify-write work — `ctx.update`, `ctx.patchOrInsert`, reorg rewinds — had no such protection and lost updates.

The existing block lock is an in-process mutex, which cannot close this on its own: the subgraph operation runner is not leader-gated, so the reindex/backfill walk routinely runs in a different process from the catch-up leader and the two share no JS state. Both walks now take a transaction-scoped Postgres advisory lock keyed `subgraph-block:<name>`, held across the block's write transaction the same way the reorg lock is held across its rewind. The key is per-subgraph, so unrelated subgraphs still walk concurrently, and no path holds this lock and the `subgraph-reorg:<name>` lock at the same time, so the two cannot deadlock; the full acquisition order is documented in `catchup.ts`.

Reindex locks only blocks that can write — with `skipProgressUpdate` set, a block whose preloaded data has no transactions and no events matches nothing and writes nothing at all — so a genesis-era range, which is overwhelmingly empty blocks, does not pay a lock round trip per block.
