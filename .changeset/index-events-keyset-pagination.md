---
"@secondlayer/api": patch
"@secondlayer/shared": patch
---

Fix O(n²) keyset pagination on `/v1/index/events` for bare event-type sources. Adds a `(event_type, block_height, event_index)` partial composite index (migration 0087) and rewrites the cursor predicate to the sargable row-values tuple form `(block_height, event_index) > (X, Y)`. Without both, the non-sargable `OR` keyset made the planner bitmap-scan the entire event-type partition on every page (e.g. ~4.2M `print` rows, ~6.8s/page); it is now an index-only range scan (~0.37ms/page).
