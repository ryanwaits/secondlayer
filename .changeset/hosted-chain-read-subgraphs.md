---
"@secondlayer/subgraphs": minor
---

Contract reads (`readContractAt`, `ctx.client`) now work in hosted subgraphs. A processor with no `STACKS_NODE_RPC_URL` that reads chain data from the hosted api reads contracts through the hosted chain-read route with its tenant key, pinned to the block like a node read. An explicit `STACKS_NODE_RPC_URL` always wins. The route's rate limit is retried by the transport (honoring `Retry-After`); a read that still can't complete aborts the block (`HandlerReadError`), and a request the route rejects as invalid (`400`) fails only the event (`ChainReadError`). A `contract-constant` read on a block with no `index_block_hash` aborts the block on hosted instead of reading the tip. A self-hosted processor pointed at the hosted api with its own key gets a `HandlerReadError` telling it to set `STACKS_NODE_RPC_URL`. The read-cache key is now a SHA-256 of the serialized args, so existing cache entries are re-read once.
