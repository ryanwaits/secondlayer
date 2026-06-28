---
"@secondlayer/subgraphs": patch
---

Fix the chain-trigger evaluator reading `sbtc_events` off the target (control) plane: that table is SOURCE-plane, so under the live source/target split the evaluator scanned an empty copy and the sBTC webhook topics never fired. `emitSbtcOutbox` now reads decoded rows via `getSourceDb()` while still writing the outbox on the target handle, with a regression test guarding the plane.
