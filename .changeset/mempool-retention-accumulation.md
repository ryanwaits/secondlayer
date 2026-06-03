---
"@secondlayer/indexer": patch
---

Let the mempool table accumulate to a useful depth instead of capping near-empty. The retention sweep is a backstop (confirm + genuine-drop are the primary eviction), so its default window goes 24h → 72h (still `MEMPOOL_RETENTION_HOURS`-tunable) — past the node's own GC horizon — and the leader-gated sweep now logs `mempool depth` at info level so accumulation is observable in prod.
