---
"@secondlayer/shared": patch
"@secondlayer/indexer": patch
---

`event_index` is now defined as the event's 0-based position in its block, and `/health/integrity` reports `eventIndexMismatches` for recent blocks that break it.
