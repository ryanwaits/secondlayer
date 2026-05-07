---
"@secondlayer/api": minor
---

Add `/v1/datasets/pox-4/calls` endpoint with filters (`function_name`, `stacker`, `delegate_to`, `signer_key`, `reward_cycle`, `from_block`, `to_block`) and tx-grain cursor pagination. Reads from the `pox4_calls` table populated by the `l2.pox4.v1` decoder. Marketing surface: `/datasets/pox-4` detail page; PoX-4 flipped to "shipped" on the dataset index.
