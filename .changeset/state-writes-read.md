---
"@secondlayer/api": minor
"@secondlayer/sdk": minor
---

New `GET /v1/index/state-writes`: the exact MARF writes each canonical block committed, `{block_height, ordinal, tx_index, key, value_hex}` in node order, cursor `<block_height>:<ordinal>`, `block_height` for one block. SDK: `index.stateWrites.list()` / `.walk()` with `IndexStateWrite`. Present only from the height the node subscribed to `state_writes`.
