---
"@secondlayer/shared": patch
---

Add migration 0075 — restores `subgraphs` + `subgraph_operations` on platform DBs that lost them during the shared→dedicated cutover. Idempotent; no-ops on OSS, fresh dev, and dedicated tenant DBs that still have the tables. Fixes the post-2026-05-14 shared-rip regression where `subgraph-processor` crash-loops on `relation "subgraphs" does not exist`.
