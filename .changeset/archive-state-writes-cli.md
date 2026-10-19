---
"@secondlayer/cli": minor
---

`secondlayer bootstrap`, `verify` and `repair` handle the `state_writes` archive dataset: bootstrap loads it after blocks, `verify --counts` checks it, and repair rewrites a fixed height's state writes with its block. Archives without `state_writes` behave as before.
