---
"@secondlayer/subgraphs": minor
---

**Behavior change:** a `ctx.client` chain read that can't complete now aborts the block instead of skipping the event. Before, a missing `STACKS_NODE_RPC_URL`, a node timeout or outage, a block with no `index_block_hash`, or a read-cache error failed only that event and the block committed without its rows. Now these throw `HandlerReadError`: the block retries, then the subgraph halts at it with status `error`, and resumes from that block once reads succeed. A contract `err` response or contract runtime error (`ContractResponseError`, `ReadContractError`) and ABI misuse (`ChainReadError`) still fail only that event.
