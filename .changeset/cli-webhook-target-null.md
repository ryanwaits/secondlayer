---
"@secondlayer/cli": patch
---

`webhooks list`/`get`/`doctor` rendered a chain webhook's Target column as `null.null` (they have no `subgraphName`/`tableName`). A chain webhook now shows its trigger types where the response has them (`get`/`doctor`), else falls back to `chain`; subgraph webhooks are unchanged (`subgraph.table`).
