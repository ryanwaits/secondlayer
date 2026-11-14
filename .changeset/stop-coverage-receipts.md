---
"@secondlayer/shared": major
---

Decoder commits no longer write per-block coverage receipts. The `@secondlayer/shared/coverage` exports `applyDecoderReceipts` and `DecoderAdapterReceipt` are removed, the `receipts` and `run_id` fields leave `DecoderAdapterCommit`, `DECODER_COMMIT_STEPS` drops `"receipt"`, and the `stage_block_receipts`, `coverage_segments` and `stage_runs` table types are removed. A migration drops those tables and `stage_failures.run_id`. The registry row is now upserted only when a failure is written.
