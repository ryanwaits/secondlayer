---
"@secondlayer/indexer": patch
---

Wires `findShortBlocks` into the canonical export audit so `continuity.complete` is false, and the export refuses to run, when a canonical block's transaction count disagrees with its persisted `tx_count`.
