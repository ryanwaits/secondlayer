---
"@secondlayer/subgraphs": patch
---

The live catch-up path now records a `subgraph_gaps` row (reason `processing_error`) whenever a block processes with handler errors, in the same transaction as the cursor advance. Previously a handler that threw had its writes rolled back but the cursor still moved past the block, silently dropping those events with nothing repairable recorded — the reindex/backfill paths already wrote gap rows, only the live path never did.
