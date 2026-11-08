---
"@secondlayer/subgraphs": patch
"@secondlayer/shared": patch
"@secondlayer/indexer": patch
---

Subgraphs scoped to a trait now wait for the contract registry before processing a block, so a matching contract deployed in a block the registry hasn't labelled yet no longer loses its events. Aborted deploys don't hold the wait back, and `/health/integrity` reports `registryLagBlocks`.
