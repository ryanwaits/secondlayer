---
"@secondlayer/shared": patch
"@secondlayer/subgraphs": patch
"@secondlayer/sdk": patch
---

Chain webhook rollbacks recall only the blocks a reorg orphaned, once each, and each entry names its `block_hash` and `block_height`
