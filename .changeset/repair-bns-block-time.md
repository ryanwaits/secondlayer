---
"@secondlayer/indexer": patch
---

Ops script rewrites BNS `block_time` / `last_event_at` from `blocks.timestamp` (dry-run default; skips timestamp=0 husks).
