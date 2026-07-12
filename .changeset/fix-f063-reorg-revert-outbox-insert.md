---
"@secondlayer/subgraphs": patch
---

fix(subgraphs): reorg revert-event outbox INSERT now actually lands — use the composite `(subscription_id, dedup_key)` conflict target (the table's real unique constraint; the old `dedup_key`-only target made Postgres reject every statement) and supply the NOT NULL `subgraph_name`/`table_name`/`block_height` columns the INSERT omitted. `.reverted` events now reach subscribers on reorg.
