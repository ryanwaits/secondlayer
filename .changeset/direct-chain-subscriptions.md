---
"@secondlayer/sdk": minor
"@secondlayer/shared": minor
"@secondlayer/subgraphs": minor
"@secondlayer/api": minor
---

feat: direct chain-level subscriptions (webhooks on chain events, no subgraph)

Subscriptions are now polymorphic: a `subgraph` subscription fires on a deployed subgraph's table rows (unchanged), or a new `chain` subscription fires on raw chain events directly — a webhook on a contract / event-type / function-call, or any SIP-010/SIP-009/custom trait — with no subgraph to deploy.

- SDK: `subscriptions.create({ triggers: [...] })` plus `on.*` trigger builders (`on.contractCall`, `on.ftTransfer`, …). New `ChainTrigger` / `SubscriptionKind` types; `SubscriptionDetail` gains `kind` + `triggers`.
- Built on the public Index/Streams clock (reuses the subgraph re-point's `PublicApiBlockSource` + matcher); forward-looking (starts at tip, never backfills).
- Reorg-safe apply/rollback delivery envelope (`chain.{type}.apply` / `chain.reorg.rollback`); per-subscription HMAC signing and all delivery formats reused unchanged.
- Trait-scoped triggers require the contract registry (`CONTRACT_REGISTRY_ENABLED=true`).
