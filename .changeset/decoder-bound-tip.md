---
"@secondlayer/subgraphs": patch
---

Bound the chain-evaluator, subgraph catch-up, and reindex tips by the slowest referenced decoder checkpoint so a lagging print decoder cannot skip heights the forward-only cursor will never revisit.
