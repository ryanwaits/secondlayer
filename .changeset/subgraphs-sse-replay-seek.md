---
"@secondlayer/api": patch
---

Make subgraph SSE `?since=<block>` replay seek instead of scan: the keyset cursor is now seeded from `MIN(_id) WHERE _block_height >= since` (falling back to the live tip when nothing matches yet) rather than starting at `_id=0` and re-scanning the whole table on every poll. The in-loop `_block_height >= since` filter stays as a reorg-safety guard.
