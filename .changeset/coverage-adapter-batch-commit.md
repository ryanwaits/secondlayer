---
"@secondlayer/shared": minor
---

Add `commitDecoderAdapterBatch` to `@secondlayer/shared/coverage` — commits several decoders' checkpoints, decoded output, receipts, and failures together in one transaction, so a crash mid-batch can't leave one decoder's checkpoint ahead of another's rows.
