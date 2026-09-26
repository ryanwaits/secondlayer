---
"@secondlayer/indexer": patch
---

The L2 decoder service's per-wake loop no longer runs `logProgress()` (a ~60-query health fan-out) whenever a decode wrote rows. It now fires only off the existing 60s progress timer, so a busy block no longer pays a health-endpoint-sized query burst before the next fetch.
