---
"@secondlayer/subgraphs": patch
---

A reindex of a subgraph that pins a contract now asks the Index for only that contract's events, skips quiet stretches where the contract prints other topics, and stops prefetching batches it is about to skip, so it no longer pulls (and bills) every print on chain or runs a small hosted processor out of memory.
