---
"@secondlayer/api": patch
---

Add `GET /api/subgraphs/:subgraphName/:tableName/aggregate` — scalar aggregates (`_count`/`_countDistinct`/`_sum`/`_min`/`_max`) over the same filter surface as the list/count endpoints. SUM/MIN/MAX round-trip losslessly as strings (NUMERIC `::text`), count/countDistinct as JSON numbers. Numeric-only + allowlist + ≤32-column cap enforced with 400s; parameterized, `ident()`-quoted, schema-qualified SQL.
