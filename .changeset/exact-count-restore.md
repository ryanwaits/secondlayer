---
"@secondlayer/api": patch
---

Revert subgraph detail row counts to exact COUNT(*); the pg_stat n_live_tup estimate read 0 for freshly-inserted (un-analyzed) tables.
