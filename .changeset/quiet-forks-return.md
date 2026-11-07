---
"@secondlayer/shared": patch
"@secondlayer/subgraphs": patch
---

Subgraphs store the hash of the block their cursor sits on, and each catch-up rewinds one whose block is no longer canonical, so a reorg the processor missed (down or not listening) no longer leaves rows from the orphaned fork. Requires migration 0197.
