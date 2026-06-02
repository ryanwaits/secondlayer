---
"@secondlayer/sdk": minor
"@secondlayer/api": minor
---

Expand the Index API with canonical block-hash map, blocks, full transaction documents, and PoX-4 stacking, plus finality-gated HTTP caching across all Index reads.

New endpoints: `GET /v1/index/canonical`, `/v1/index/blocks` (+ `/:height_or_hash`), `/v1/index/transactions` (+ `/:tx_id`, full documents with fee/nonce/post-conditions decoded from `raw_tx`), and `/v1/index/stacking`. All Index responses now carry `Cache-Control` and ETag/304 for finalized ranges. New SDK clients: `index.canonical`, `index.blocks`, `index.transactions`, and `index.stacking` (each with `list`/`walk`, and `get` for blocks/transactions).
