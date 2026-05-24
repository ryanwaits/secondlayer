---
"@secondlayer/sdk": major
---

Rename streams `index_block_hash` to `block_hash` on `StreamsEvent`, `StreamsTip`, and `StreamsCanonicalBlock`. The field always carried the block header hash (matching Hiro's `hash`), not the Stacks index block hash.
