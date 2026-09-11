---
"@secondlayer/api": patch
"@secondlayer/subgraphs": patch
---

Refuse deploys whose print samples write 0 rows (`EMPTY_MAPPING` 422) and surface `health.emptyMapping` on subgraph status after processing with empty tables.
