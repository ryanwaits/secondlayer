---
"@secondlayer/indexer": patch
---

Decoder health now reports `checkpoint_committed_height` alongside the raw `checkpoint_block_height`, using the shared committed-height rule (a mid-block cursor floors to H-1; the empty-range sentinel means H is done). The generic decoder logs one `decoder_checkpoint_advanced` event whenever a checkpoint write moves that committed height forward. Prod's `DECODER_EMPTY_BACKOFF_MS` default is back to 1000ms (from 5000ms): trades ~5x idle query volume for ~2s lower decoder latency at the tip, a stopgap until decoders wake on write instead of polling.
