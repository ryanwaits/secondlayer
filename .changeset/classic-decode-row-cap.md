---
"@secondlayer/indexer": patch
"@secondlayer/shared": patch
---

Fixes quadratic classic-decode latency on heavy blocks: the in-process classic-decoder loop's page limit was tied to `DECODER_BATCH_SIZE` (500, shared with the HTTP-facing decoders), so a block with thousands of events cost several reader calls, each re-scanning and re-ordinating the WHOLE block. Decouples the loop's row cap (`DEFAULT_CLASSIC_BATCH_LIMIT`, now 10,000, overridable via `CLASSIC_DECODE_ROW_CAP`) from that HTTP page size, so a typical heavy block now costs one reader call. The existing per-page commit path still handles anything bigger. Also chunks the `decoded_events` and `stage_block_receipts` inserts so a single large page's commit stays under Postgres's bind-parameter limit.
