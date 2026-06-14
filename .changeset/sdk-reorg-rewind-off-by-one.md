---
"@secondlayer/sdk": patch
---

Fix a reorg off-by-one in the Index and Streams `consume()` loops. On a reorg,
the consumer rewound to `Cursor.atHeight(forkPoint)`, which returned
`${forkPoint}:0` — an *exclusive* cursor, so the fork block's first event
`(forkPoint, 0)` was never re-read and the new canonical run lost its first row.
`Cursor.atHeight` now returns the true foot of the height
(`${forkPoint-1}:<int4-max>`), so the rewind re-reads from `forkPoint:0`
inclusive. Pairs with the example/docs `onReorg` rollback, which must delete
`block_height >= fork_point_height` (inclusive of the fork block). Reorg
envelope docstrings (`IndexReorg`/`StreamsReorg.new_canonical_tip`) corrected:
it marks the first new-canonical position (`fork:0`, inclusive), not a directly
resumable exclusive cursor.
