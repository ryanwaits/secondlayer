---
"@secondlayer/subgraphs": patch
---

Co-gate the chain-subscription reorg handler under the evaluator leader lock. `handleChainReorg` rewinds `trigger_evaluator_state.last_processed_block` — the same row the evaluator advances — so on a multi-replica plane it must run only on the elected evaluator leader, else a non-leader reorg rewind races the leader's forward cursor. The reorg poll now wraps the chain-reorg callback in `gateChainReorgOnLeader` (fires only when `isEvaluatorLeader()`); the subgraph-reorg handler stays ungated (idempotent row-deletes).
