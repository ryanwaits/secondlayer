---
"@secondlayer/indexer": patch
"@secondlayer/api": patch
---

fix two L2 decoder health bugs that surfaced during the 2026-05-12 BNS backfill experiment.

(1) `getL2DecoderHealth` reported `status: ok` for decoders stuck in error-retry loops. The `runDecoder` `finally` block bumps `checkpoint.updated_at` every iteration as a liveness ping — `checkpointRecent` was true even when the decoder was failing every fetch. Treated heartbeat as sufficient. Now treat it as necessary: status is healthy only when the heartbeat is recent AND there's a real-work signal (`nearTip` or `writesRecent`). Decoder stuck mid-history with no writes now correctly reports unhealthy in ~5 min instead of forever.

(2) `lag_seconds` returned ~1.78B (~56 years) when checkpoint moves backwards onto a block whose row in the `blocks` table has `timestamp = 0` (a historical bulk-import artifact). Added a defensive `timestamp > 0` guard; returns `null` for the unmeasurable case, matching the existing "no checkpoint yet" shape that dashboards already handle.
