---
"@secondlayer/subgraphs": patch
---

Stop booting the subscription delivery plane inside the subgraph processor now that the dedicated subscription-processor service runs it. `startSubgraphProcessor` no longer calls `startSubscriptionPlane()` — it handles subgraph operations, catch-up, and the subgraph-reorg rewind only, while the evaluator, outbox emitter, and chain-reorg rewind live solely in the subscription-processor. Completes the two-deploy extraction (the prior release ran both alongside, made safe by leader election); webhook delivery is now isolated from subgraph indexing.
