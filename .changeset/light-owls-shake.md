---
"@secondlayer/subgraphs": minor
"@secondlayer/stacks": minor
"@secondlayer/cli": minor
---

Subgraph handlers can read contract state. `readContractAt(ctx, contractId, abi, options)` returns the ABI's camelCased read-only methods — same shape as `getContract`, minus `call`, since a handler indexes the chain and never writes to it.

Every read is pinned to the block being processed via its `index_block_hash`, so a handler stays a pure function of its block and a reindex produces byte-identical rows. A block whose id was never persisted throws rather than falling back to the node's tip. Results are memoized in Postgres (`chain_read_cache`, keyed on the block id so a reorg-replaced block can't inherit the orphaned fork's answer); `cache: "contract-constant"` resolves a value once for the contract instead of once per block, which is what makes a full backfill affordable.

Needs `STACKS_NODE_RPC_URL` on the subgraph processor — the node you already run, no new service. `SUBGRAPH_CHAIN_READ_CONCURRENCY` (default 4) bounds concurrent node reads.

Also:

- `@secondlayer/stacks`: `readContract` accepts a `tip` to evaluate against a specific block; `buildFunctionArgs`, `isResponseOutput`, `clarityValueToJSUntyped`, and the `UnwrapResponse` type are exported for building typed call layers.
- Index `/v1/index/blocks` rows carry `index_block_hash`.
- `createTestContext(schema, { reads })` stubs chain reads by `"<contract>.<function-name>"`, so handler unit tests stay offline; an unstubbed read throws naming the key.
- The `sip-010-balances` starter labels tokens with their real symbol and decimals, and hoists its schema with `defineSchema`.
