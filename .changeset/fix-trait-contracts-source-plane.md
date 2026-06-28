---
"@secondlayer/subgraphs": patch
---

Fix `buildTraitContracts` reading the `contracts` registry off the target (control) plane: `contracts` is SOURCE-plane, so under the live split the evaluator and chain-replay resolved zero trait members and trait-scoped subscriptions never matched. Now reads via `getSourceDb()` — same plane-read class as the sbtc_events fix.
