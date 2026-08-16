---
"@secondlayer/indexer": patch
---

Fix a block-ingest perf regression: the reorg-safe events delete in `persistBlock` OR'd a block-height predicate with a tx-id subquery in a single statement, which made Postgres seq-scan the entire events table on every block instead of using either index. Split into two sequential deletes (by height, then by tx id) so each uses its own index; semantics are unchanged.
