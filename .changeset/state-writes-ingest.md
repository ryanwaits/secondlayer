---
"@secondlayer/shared": minor
---

New `state_writes` / `state_writes_archive` tables (`StateWritesTable`, `InsertStateWrite`) for the node's opt-in `"state_writes"` payload: exact MARF writes per block, keyed `(block_height, ordinal)`. `LocalClient.getBlockForReplay` now replays them as `state_writes`.
