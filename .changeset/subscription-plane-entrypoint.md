---
"@secondlayer/subgraphs": patch
---

Factor the real-time subscription delivery plane (chain-trigger evaluator, outbox emitter, chain-reorg rewind) into `startSubscriptionPlane()` and add a dedicated `subscription-service.ts` entrypoint that boots only that plane. This isolates webhook delivery from subgraph indexing so a crash-looping or CPU-hot subgraph can't stall deliveries, and lets the plane scale out on its own. The subgraph processor still boots the same plane for now (a later two-deploy cutover moves it to the dedicated service). The Streams reorg poll is simplified to a single per-fork callback so each plane runs its own poll — subgraph-reorg rewind in the subgraph processor, chain-subscription rewind in the subscription plane.
