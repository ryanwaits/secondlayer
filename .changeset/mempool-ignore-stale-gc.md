---
"@secondlayer/indexer": patch
---

Keep mempool txs the node drops as `StaleGarbageCollect` (its own memory-pressure GC) instead of hard-deleting them — one node's aggressive GC was draining the mempool to near-empty. Genuine drops (RBF, replace-across-fork, problematic) are still honored; stale-GC'd txs clear via eviction-on-confirmation or the retention sweep.
