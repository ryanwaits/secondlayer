---
"@secondlayer/api": patch
"@secondlayer/sdk": patch
---

Add `reorgs[]` to the Index `/v1/index/stacking` response so a client tracking stacking actions gets the same height-granular reorg reconciliation signal as `/contract-calls` and `/transactions`. `getStackingResponse` now reads `readChainReorgsForHeightRange` over the returned block-height range (over-inclusive, never under-reports; skipped on an empty page), and the SDK `StackingEnvelope` carries the matching `reorgs` field.
