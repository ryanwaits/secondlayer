---
"@secondlayer/indexer": patch
---

pox-4 calls and BNS name/namespace/marketplace dataset exports now filter `canonical = true`, matching the sBTC/stx datasets; previously fork-side rows left behind by the mark-non-canonical-in-place reorg model leaked into the published Parquet datasets.
