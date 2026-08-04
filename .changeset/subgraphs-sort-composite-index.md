---
"@secondlayer/subgraphs": minor
---

Emit a composite `(column, "_id")` index alongside every single-column index on an `indexed: true` column, so `/v1` keyset-paginated sorts on that column stay fast on deep pages (measured: ~200x fewer buffer reads on a low-cardinality column). The single-column index is kept too, for equality filters. New subgraphs get both indexes on first deploy; already-deployed subgraphs pick up the composite on their next schema change, force-reindex, or rebuild — a plain unchanged redeploy does not run any DDL.
