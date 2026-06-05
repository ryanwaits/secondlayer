---
"@secondlayer/subgraphs": patch
---

Leader-elect the chain-trigger evaluator so the real-time subscription plane can scale out. Previously the evaluator ran unconditionally on every replica against one global cursor (N replicas → N× redundant Index fetch+match each tick; correct via `dedup_key`, but a de-facto one-replica cap). The whole loop now runs only on the process holding `SUBSCRIPTION_EVALUATOR_LOCK_KEY`, with the lock pinned to the target DB that homes `trigger_evaluator_state`. Exposes `isEvaluatorLeader()` so the chain-reorg cursor rewind can gate on the same election.
