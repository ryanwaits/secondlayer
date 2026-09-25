---
"@secondlayer/subgraphs": patch
"@secondlayer/shared": patch
"@secondlayer/api": patch
"@secondlayer/cli": patch
---

Fix a reorg race where a webhook row claimed (or previously attempted) mid-reorg could be silently deleted instead of rolled back; it's now marked dead and included in `chain.reorg.rollback` instead. Delivery caps (`max_retries`, `timeout_ms`) are now configurable ceilings via `WEBHOOK_MAX_RETRIES_CEILING` and `WEBHOOK_TIMEOUT_MS_CEILING` (self-host defaults unchanged). Add missing SSRF ranges (benchmarking, multicast, reserved/broadcast, IPv6 multicast, NAT64). Replay range is now capped via `WEBHOOK_REPLAY_MAX_BLOCKS` (default unchanged) and returns 409 on a concurrent replay for the same webhook. A chain webhook on an instance without the chain-trigger evaluator running now warns on create, on every read, at plane boot, and in `secondlayer webhooks doctor`.
