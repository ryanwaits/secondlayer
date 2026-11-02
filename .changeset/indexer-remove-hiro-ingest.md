---
"@secondlayer/indexer": patch
---

Remove the manual Hiro backfill and repair scripts and the transaction decode API fallback. Decoders checkpoint from `ctx.cursor`.
