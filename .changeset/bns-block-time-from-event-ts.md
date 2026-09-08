---
"@secondlayer/indexer": patch
---

BNS decoder writes `block_time` from the Streams event `ts` instead of wall-clock at decode time.
