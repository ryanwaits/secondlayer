---
"@secondlayer/indexer": patch
---

Sizes the canonical export's free-space check from the previous local snapshot's total byte size plus a margin, instead of a fixed 100GB, so it tracks the chain's actual growth instead of drifting from production disk reality. Falls back to the fixed default when there is no previous manifest to measure.
