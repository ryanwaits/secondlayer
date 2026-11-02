---
"@secondlayer/subgraphs": major
"@secondlayer/mcp": patch
"@secondlayer/api": patch
---

Remove the `@secondlayer/subgraphs/types` subpath: import those types from `@secondlayer/subgraphs`, which now also exports `NestedContractCallFilter`, `VarSetFilter` and `MapWriteFilter`. Remove the experimental `SUBGRAPH_SOURCE=observer-http` block source, and replace `SUBGRAPH_REINDEX_BATCH_SIZE`, `SUBGRAPH_REINDEX_MIN_BATCH_SIZE`, `SUBGRAPH_REINDEX_MAX_BATCH_SIZE` and `SUBGRAPH_CHAIN_READ_CONCURRENCY` with fixed values. Stop re-exporting `formatFinding` from the package root and the format builders from `runtime/formats`.
