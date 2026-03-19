# @secondlayer/shared

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
