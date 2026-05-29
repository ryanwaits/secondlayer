---
"@secondlayer/cli": minor
---

Add `sl devnet status` and `sl devnet logs` for the local Clarinet devnet stack. `status` prints a snapshot — service health, ingest tip/lag, deployed subgraphs with table + row counts, and a recent-activity table built from the subgraph rows (with `--watch` to refresh). `logs` tails the stack's container logs (all services or one of indexer/api/subgraph-processor/postgres). Both are node-native.
