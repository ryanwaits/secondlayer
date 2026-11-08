---
"@secondlayer/sdk": patch
---

`decodeChainWebhook` validates a `chain.reorg.rollback` body: the fork point must be a non-negative integer and each orphaned entry must be an object with a string or null `tx_id` and `block_hash` and a non-negative integer `block_height`. A malformed rollback throws instead of reaching your delete.
