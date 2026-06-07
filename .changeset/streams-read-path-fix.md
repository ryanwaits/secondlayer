---
"@secondlayer/shared": patch
"@secondlayer/indexer": patch
---

Fix the Streams read-path hot spot. Add chain-plane indexes on `events` for the firehose payload filters — `(block_height, type)` plus partial expression indexes on `data->>'sender'`, `data->>'recipient'`, and `data->>'asset_identifier'` (partial `IS NOT NULL` so an equality filter provably uses them regardless of `types=`). Replace the per-row correlated `COUNT(*)` that computed each event's per-block `stream_event_index` (O(rows × block_events) across all four Streams read paths) with a single `ROW_NUMBER()` window over the block's all-types event set — byte-identical ordinals, so the cursor-stability contract (an event's `stream_event_index` is the same with or without filters) is preserved and now covered by a dedicated test. Build the indexes with `CREATE INDEX CONCURRENTLY` in prod before deploy (the migration is `IF NOT EXISTS` no-op there).
