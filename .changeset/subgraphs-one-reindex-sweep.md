---
"@secondlayer/subgraphs": patch
---

Fold the two boot-time sweeps that re-enqueue stranded reindexes into one. It now also picks up a subgraph left at `reindexing` without resume metadata, which restarts its reindex.
