---
"@secondlayer/sdk": minor
"@secondlayer/shared": minor
"@secondlayer/api": minor
"@secondlayer/indexer": minor
---

Add mempool (pending transactions) to the Index API.

The indexer now persists unconfirmed transactions from the Stacks node's `/new_mempool_tx` observer callback (deriving the txid from raw_tx), evicts them on confirmation (block ingest) or drop (`/drop_mempool_tx`), and sweeps stuck rows. The Index API serves them at `GET /v1/index/mempool` (filter by `sender`/`type`, cursor-paginated) and `GET /v1/index/mempool/:tx_id` — full pending-transaction documents (fee/nonce/post-conditions decoded from raw_tx), minus the block-anchored fields, plus `received_at`. Mempool reads are never cacheable (volatile). New SDK client: `index.mempool` (`list`/`walk`/`get`).
