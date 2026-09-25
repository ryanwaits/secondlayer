---
"@secondlayer/subgraphs": major
"@secondlayer/api": minor
"@secondlayer/shared": minor
"@secondlayer/bundler": minor
"@secondlayer/cli": minor
"@secondlayer/sdk": minor
"@secondlayer/scaffold": minor
"@secondlayer/mcp": patch
---

Remove unused public surface: the `./triggers` and `./runtime/source-matcher` subpaths, and the root exports `reindexSubgraph`, `resumeReindex`, `backfillSubgraph`, `validatePrintPayload`, `camelizeDataKey` and `INDEX_CODEGEN_TABLES`. The processor runs as a service; import `defineSubgraph` and the types as before. Drop the `/api/subgraphs/:name/openapi` redirect; use `openapi.json`.

Trim how a subgraph is defined to one way per job:

- `ctx` write verbs are `insert`, `update`, `upsert`, `delete` and `increment`; reads are `findOne` and `findMany`. Removed: `ctx.patch` (it was `update`), `ctx.patchOrInsert` and the `ComputedValue` type (use `increment` for running totals, or `findOne` then `upsert`), and the handler aggregates `ctx.count`, `sum`, `min`, `max`, `countDistinct` and `ctx.formatUnits` (query the table's REST aggregates instead; `formatUnits` lives in `@secondlayer/stacks/utils`).
- Every source needs a handler of the same name. The `"*"` catch-all handler is removed, and so is `materialize`: `--from-contract` now scaffolds a one-line `ctx.insert` handler per topic.
- Table `relations` (foreign keys and the Prisma/Drizzle relation codegen) is removed.
- The definition `version` field is removed; the server numbers deploys. `DeploySubgraphRequest.version` and the bundle response's `version` are gone with it.
- A `contract_call` source with `functionName` no longer needs a hand-pasted `abi`: `secondlayer subgraphs deploy` (and the CLI's bundle, spec and codegen paths) fetch the deployed contract's ABI and write it into the definition. Pass `abi` yourself for wildcard, multi-contract or trait sources, or a local deploy. Bundler adds `injectSourceAbis`.
- Tip-first and backfill guards now also refuse handlers that read rows with `findOne`/`findMany`, since a read-modify-write depends on block order.
