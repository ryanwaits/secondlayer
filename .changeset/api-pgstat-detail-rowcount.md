---
"@secondlayer/api": patch
---

Replace per-table COUNT(*) fan-out on subgraph detail endpoint with a single pg_stat_user_tables read for approximate row counts.
