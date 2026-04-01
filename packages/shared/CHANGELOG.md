# @secondlayer/shared

## 0.8.0

### Minor Changes

- [`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Add subgraph gap detection, tracking, and backfill across runtime, API, SDK, and CLI

## 0.7.1

### Patch Changes

- Batch block fetching with adaptive sizing and prefetch pipeline for 15-18x faster subgraph catch-up. Batch INSERT statements on flush. Non-destructive backfill support. Increase default DB connection pool to 20.

## 0.7.0

### Minor Changes

- Cache Hiro event archive locally for up to 24h to avoid redundant ~25GB downloads during auto-backfill.

## 0.6.1

### Patch Changes

- Add ArchiveReplayClient for backfilling from Hiro event observer archive, removing public API dependency

## 0.6.0

### Minor Changes

- Add HiroPgClient for direct-PG bulk backfill, increase default fetch timeout to 120s.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.2.2

## 0.5.1

### Patch Changes

- Migrate all zod imports from v3 compat layer to zod/v4 and fix type errors.

## 0.5.0

### Minor Changes

- 4b716bd: Rename "views" product to "subgraphs" across entire codebase. Package `@secondlayer/views` is deprecated in favor of `@secondlayer/subgraphs`. All types, functions, API routes, CLI commands, and DB tables renamed accordingly.

## 0.4.0

### Minor Changes

- Add contract query helpers with full-text search via pg_trgm. Add `getContractAbi()` for Stacks node RPC. Add `ForbiddenError` class. Treat Hiro 429 responses as reachable and increase health check timeout. Drop contracts table in favor of views system.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.2.0

## 0.3.0

### Minor Changes

- 48e42ba: Add local replay client for self-serve block reconstruction from Postgres. Add tx_index migration and type. Export local-client from package.

### Patch Changes

- Updated dependencies [a070de2]
  - @secondlayer/stacks@0.1.0

## 0.2.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.4

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.3

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.2

## 0.2.0

### Minor Changes

- Add @secondlayer/shared package with DB layer, job queue, schemas, HMAC signing, and Stacks node clients
