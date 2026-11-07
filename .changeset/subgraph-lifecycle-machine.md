---
"@secondlayer/shared": minor
"@secondlayer/subgraphs": minor
"@secondlayer/api": minor
"@secondlayer/cli": patch
"@secondlayer/workload": patch
---

Subgraph status is now one state machine (`active`, `reindexing`, `error`) with a database CHECK. A halted subgraph stays `error` until a redeploy or a reindex: live commits and a running reindex no longer undo it. A reorg now reaches a subgraph that is mid-reindex and rewinds rows past the fork. A billing pause is `billingPausedCode` on the subgraph summary and health (it no longer lives in `lastError`), and a subgraph halted after repeated block failures says so in `lastError`. `syncState` (`@secondlayer/shared/schemas`) is the one derivation of synced, catching up, reindexing and error. The unused `paused` status and `expires_at` column are removed.
