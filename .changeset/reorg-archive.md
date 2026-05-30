---
"@secondlayer/shared": minor
"@secondlayer/indexer": minor
---

Preserve reorged rows instead of destroying them. On a reorg that reuses a height with a new block hash, the indexer now copies the orphaned transactions/events into new `transactions_archive` / `events_archive` tables (migration 0084) before replacing the height, tagged with the displaced block hash. The main tables stay canonical-only so all readers are unaffected, while the raw log is preserved and queryable — honoring the immutable-log guarantee. A redelivery of the same block is not a reorg and is not archived.
