---
"@secondlayer/subgraphs": patch
---

`SubgraphFilterSchema` is now `.strict()`, so unknown fields inside a `sources: {}` entry (most commonly a mis-placed `startBlock`) error at validate time instead of being silently dropped. `startBlock` is only valid at the top level of `defineSubgraph()`.
