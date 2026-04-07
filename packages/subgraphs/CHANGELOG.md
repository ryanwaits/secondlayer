# @secondlayer/subgraphs

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
