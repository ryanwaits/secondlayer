---
"@secondlayer/shared": minor
"@secondlayer/subgraphs": patch
---

Make the LISTEN/NOTIFY listener split-aware. Export `sourceListenerUrl()` / `targetListenerUrl()` from `@secondlayer/shared/queue/listener` and bind the subscriptions emitter (`subscriptions:new_outbox` / `subscriptions:changed`) to the TARGET DB where those channels fire. Previously the emitter passed no connection string and fell back to `DATABASE_URL`, crashing the subgraph-processor under the active source/target split when `DATABASE_URL` was unset. The subgraph-processor's block/reorg/operation listeners now share the same shared helpers (dedup).
</content>
