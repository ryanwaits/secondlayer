---
"@secondlayer/sdk": minor
---

`events.replay()` now forwards an optional `onReorg` to its live-tail seam — long-lived replay tails handle reorgs with the same contract as `consume()` (the dump-backfill phase is finalized and never reorgs)
