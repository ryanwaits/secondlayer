---
"@secondlayer/shared": minor
---

Promote the Postgres advisory-lock leader-election util to `@secondlayer/shared/leader` (`withLeaderLock`, `createPostgresLeaderBackend`, lock-key constants) so the subscription evaluator, chain-reorg handler, and subgraph catch-up can share one fleet-wide election primitive with the indexer. `createPostgresLeaderBackend(url?)` now accepts an explicit lock-DB URL — required after the source/target split, since control-plane state (subscriptions, subgraphs) lives on the target DB and a lock on the default source DB would guard nothing. Adds distinct `SUBSCRIPTION_EVALUATOR_LOCK_KEY` and `SUBGRAPH_CATCHUP_LOCK_KEY` keys.
