---
"@secondlayer/sdk": minor
"@secondlayer/api": patch
---

Add a `contract_id` filter to `/v1/index/mempool` (and `sl.index.mempool.list/walk({ contractId })`) — watch pending calls to a single contract in one query, for keepers and agent feeds.
