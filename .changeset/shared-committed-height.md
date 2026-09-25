---
"@secondlayer/shared": minor
---

Adds `committedHeight()`, the shared committed-height rule for a decoder/consumer cursor (`H:n` — the empty-range sentinel means H is fully committed, otherwise the floor is H-1). Previously duplicated inside `@secondlayer/subgraphs`; now one implementation both that package and the Index API share. `webhook_outbox` also gains a nullable `block_time` column, filled by the chain-webhook evaluator so `delivered_at - block_time` can measure end-to-end webhook latency without a join to the source-plane `blocks` table.
