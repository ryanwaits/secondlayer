---
"@secondlayer/subgraphs": patch
---

Subscription replay now pages historical rows by an `_id` keyset instead of `LIMIT/OFFSET`. `_created_at` is written as the SQL literal `NOW()`, so every row a subgraph writes for one block shares the exact same value — `ORDER BY _block_height, _created_at` has no tiebreaker across a page boundary, and Postgres can return tied rows in a different order per query. With `OFFSET` pagination that meant rows could be silently skipped (repeats were absorbed by the dedup constraint, but skips were data loss) for any block that wrote more than 500 rows to one table. `_id` is `BIGSERIAL` and total, so paging by it can't drop rows.
