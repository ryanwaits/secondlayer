---
"@secondlayer/shared": patch
---

Fix `ArchiveReplayClient.replayGaps` crashing on large backfills. It computed the max target height with `Math.max(...gapHeights)`, which spreads the entire gap set as call arguments — a full-history backfill (millions of heights) hit the call-stack limit and threw `RangeError` instantly. Now computes the max by iteration, and samples unmatched heights without spreading the whole set.
