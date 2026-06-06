---
"@secondlayer/shared": minor
"@secondlayer/sdk": minor
"@secondlayer/subgraphs": patch
---

Export typed chain-subscription webhook envelopes. `ChainApplyEnvelope`, `ChainReorgRollbackEnvelope`, `ChainReorgOrphanedEntry`, and the `ChainWebhookEnvelope` union are now single-sourced in `@secondlayer/shared` (the subgraphs producer uses them) and re-exported from `@secondlayer/sdk`, so webhook consumers can type the `chain.*.apply` / `chain.reorg.rollback` bodies they receive instead of reading code.
