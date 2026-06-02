---
"@secondlayer/sdk": minor
---

`events.consume()` now owns reorg handling and checkpoint computation. New `onReorg(reorg, { cursor })` callback fires once per deduped reorg — roll your projection back to `reorg.fork_point_height` and the SDK rewinds the cursor and re-reads the now-canonical events (the re-reported-reorg loop and fork-point math are handled internally). New `finalizedOnly` flag emits only immutable events and never surfaces reorgs. `onBatch` gains a third `ctx` arg carrying the checkpoint cursor to persist (the last finalized event in `finalizedOnly` mode, else `next_cursor`). Exposes a `Cursor` helper (`atHeight`, `parse`) and documents `event.cursor` as the projection primary key. All additions are optional and back-compatible; the return-a-cursor path is unchanged.
