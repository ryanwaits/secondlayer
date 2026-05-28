---
"@secondlayer/cli": minor
---

Add `sl devnet connect` and `sl devnet down` to run Secondlayer services against a local Clarinet devnet. `connect` patches your clarinet project's `settings/Devnet.toml` to forward block events to a local indexer, writes a docker compose pinned to the published OSS images, and starts the stack — so `clarinet devnet start` streams straight into subgraphs, datasets, and subscriptions locally.
