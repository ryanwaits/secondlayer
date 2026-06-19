---
"@secondlayer/subgraphs": patch
---

Avoid redundant array allocation in read-your-writes overlay: early-out when no ops are pending, mutate in place for update ops instead of re-mapping per op.
