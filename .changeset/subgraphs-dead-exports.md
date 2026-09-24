---
"@secondlayer/subgraphs": major
"@secondlayer/api": patch
---

Remove unused public surface: the `./triggers` and `./runtime/source-matcher` subpaths, and the root exports `reindexSubgraph`, `resumeReindex`, `backfillSubgraph`, `validatePrintPayload`, `camelizeDataKey` and `INDEX_CODEGEN_TABLES`. The processor runs as a service; import `defineSubgraph` and the types as before. Drop the `/api/subgraphs/:name/openapi` redirect; use `openapi.json`.
