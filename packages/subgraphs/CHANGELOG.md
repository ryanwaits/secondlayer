# @secondlayer/subgraphs

## 0.11.1

### Patch Changes

- fix(subgraphs): complete accountId migration across deployer, marketplace, ownership

  Removes remaining apiKeyId fallbacks introduced in the Sprint 1 account-scoping change:

  - deployer.ts: getSubgraph lookup no longer falls back to apiKeyId
  - marketplace.ts: fork collision check and schema prefix use accountId
  - ownership.ts: assertSubgraphOwnership checks account_id instead of api_key_id
  - deleteSubgraph: uses accountId parameter consistently

- Updated dependencies []:
  - @secondlayer/shared@0.12.1

## 0.11.0

### Minor Changes

- feat(subgraphs): smart deploy — auto-versioning, auto-reindex, schema diff

  - System now owns versioning: patch auto-increments on every deploy (1.0.0 → 1.0.1); use --version flag for intentional bumps
  - Breaking schema changes auto-trigger reindex — no --reindex flag needed
  - Deploy output shows schema diff (added tables/columns, breaking changes, new version)
  - version field removed from schema hash so version bumps don't look like schema changes
  - --force flag skips reindex confirmation prompt
  - Handler code persisted in DB so container restarts don't break in-flight reindexes (migration 0029)

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.12.0

## 0.10.0

### Minor Changes

- feat(subgraphs): account-wide subgraph scoping

  Subgraphs are now scoped at the account level rather than per API key. Any API key on the same account can deploy and update the same named subgraph without creating duplicates. Includes migration 0028 which adds `account_id` to the subgraphs table and renames existing PG schemas to use account prefix instead of key prefix.

  **Breaking for self-hosted:** Run migration 0028 before deploying. Stop the subgraph processor before running the migration (it renames live PG schemas).

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.11.0

## 0.9.5

### Patch Changes

- fix(subgraphs): parse JSONB string for function_args before array check

  postgres.js returns JSONB columns as JSON-encoded strings rather than parsed JavaScript objects. The function_args decoder was calling Array.isArray() on a string and always returning [], causing args_json to be empty for every indexed contract call. Now correctly parses the string before the array check.

## 0.9.4

### Patch Changes

- fix(subgraphs): expose resultHex in contract_call handler payload

  Adds `resultHex` (raw hex string) to the contract_call event payload so handlers can store the unmodified transaction result. Previously only the decoded Clarity object was available, causing `String(result)` to produce `[object Object]`.

  fix(indexer): normalize Hiro API function_args to hex strings

  Parser fallback now extracts `.hex` from `{hex,repr,name,type}` objects returned by the Hiro API, ensuring function_args are stored as hex strings consistently across all backfill sources.

## 0.9.3

### Patch Changes

- Allow ComputedValue callbacks to return unknown so existing record field access doesn't need casts

## 0.9.2

### Patch Changes

- Narrow ComputedValue type so patchOrInsert callback params are inferred without explicit annotation

## 0.9.0

### Minor Changes

- 885662d: feat(subgraphs): named-object sources with SubgraphFilter discriminated union

  Breaking: sources changed from `SubgraphSource[]` to `Record<string, SubgraphFilter>`. Handler keys are now source names, not derived sourceKey strings. Event data auto-unwrapped via cvToValue. New context methods: patch, patchOrInsert, formatUnits, aggregates.

### Patch Changes

- Updated dependencies [885662d]
  - @secondlayer/shared@0.10.1

## 0.8.1

### Patch Changes

- Fix phantom gaps caused by adaptive batch sizing: batchEnd now uses the actual prefetched range instead of the potentially resized batchSize.

## 0.8.0

### Minor Changes

- Deploy-resilient reindexing: abort support, auto-resume on startup, graceful shutdown, and `sl subgraphs stop` command.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.10.0

## 0.7.3

### Patch Changes

- Cache compiled regex patterns in source matcher, use pg_stat estimates instead of COUNT(\*) for row count warnings.

## 0.7.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.9.0

## 0.7.1

### Patch Changes

- e274333: fix(subgraphs): use highest_seen_block ceiling and add startBlock support
- Updated dependencies [e274333]
  - @secondlayer/shared@0.8.1

## 0.7.0

### Minor Changes

- [`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Add subgraph gap detection, tracking, and backfill across runtime, API, SDK, and CLI

### Patch Changes

- Updated dependencies [[`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757)]:
  - @secondlayer/shared@0.8.0

## 0.6.0

### Minor Changes

- Batch block fetching with adaptive sizing and prefetch pipeline for 15-18x faster subgraph catch-up. Batch INSERT statements on flush. Non-destructive backfill support. Increase default DB connection pool to 20.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.7.1

## 0.5.7

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.7.0

## 0.5.6

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.6.0
  - @secondlayer/stacks@0.2.2

## 0.5.5

### Patch Changes

- Migrate all zod imports from v3 compat layer to zod/v4 and fix type errors.

- Updated dependencies []:
  - @secondlayer/shared@0.5.1

## 0.5.4

### Patch Changes

- Export template registry from subgraphs package.

## 0.5.3

### Patch Changes

- fix(subgraphs): fix Zod v4 type cast in validate.ts
  chore(sdk): remove dangling ./contracts export

## 0.5.2

### Patch Changes

- Coerce numeric columns to BigInt in findOne/findMany results so arithmetic works correctly in handlers.

## 0.5.1

### Patch Changes

- CLI: bundle updated SDK with query response unwrap fix. Subgraphs: use NUMERIC for uint/int columns to handle Clarity values > bigint max.

## 0.5.0

### Minor Changes

- 4b716bd: Rename "views" product to "subgraphs" across entire codebase. Package `@secondlayer/views` is deprecated in favor of `@secondlayer/subgraphs`. All types, functions, API routes, CLI commands, and DB tables renamed accordingly.

### Patch Changes

- Updated dependencies [4b716bd]
  - @secondlayer/shared@0.5.0

## 0.3.0

### Minor Changes

- Add trigram search support for full-text indexed queries. Add contract-deployments reference subgraph. Fix contractId resolution in deployment handler. Replace string-matching error detection with typed guard functions.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.4.0
  - @secondlayer/stacks@0.2.0

## 0.2.4

### Patch Changes

- Updated dependencies [48e42ba]
- Updated dependencies [a070de2]
  - @secondlayer/shared@0.3.0
  - @secondlayer/stacks@0.1.0

## 0.2.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.4
  - @secondlayer/shared@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.3
  - @secondlayer/shared@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.2
  - @secondlayer/shared@0.2.1

## 0.2.0

### Minor Changes

- Add @secondlayer/subgraphs - Subgraph definition, validation, schema generation, and deployment for materialized blockchain subgraphs
