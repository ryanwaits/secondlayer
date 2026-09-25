---
"@secondlayer/api": patch
---

`GET /public/status`'s `index.decoders[]` now includes `committedBlockHeight` alongside `checkpointBlockHeight` — the same committed-height rule the Subgraphs runtime already applies to a local checkpoint (sentinel cursor = block done, mid-block = floor to H-1). Additive: existing consumers of `checkpointBlockHeight` are unaffected.
