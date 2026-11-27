---
"@secondlayer/shared": major
"@secondlayer/subgraphs": patch
"@secondlayer/cli": patch
---

`vm_events` rows are keyed to their transaction by `(block_height, tx_index)`. `VmEventsTable` drops `tx_id` and `created_at` and gains `tx_index`; public Index and Streams rows still return `tx_id` and `tx_index`.
