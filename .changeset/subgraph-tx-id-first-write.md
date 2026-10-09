---
"@secondlayer/subgraphs": patch
---

A row's `_tx_id` and `_block_height` now always name the write that created it. Before, when one block created a key and upserted it again from a later tx, the stored row could take the later write's `_tx_id`; across blocks it already kept the first. Postgres and the in-memory store (replay, `createTestContext`) now agree on every column. Served `_tx_id` can change only for keys created and updated in the same block, and only for writes made after upgrading: existing rows keep their value unless the subgraph is reindexed. User columns are unchanged (last write wins).
