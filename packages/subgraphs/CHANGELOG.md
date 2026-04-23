# @secondlayer/subgraphs

## 1.0.0-alpha.0

### Major Changes

- Declaring stable (1.0) ahead of subscription emission work (Sprint 3). No API changes in this release; major bundles the break point for subscription wiring that lands next sprint.

### Patch Changes

- Updated dependencies [[`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11), [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c), [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4), [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8), [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2)]:
  - @secondlayer/shared@3.0.0-alpha.0
  - @secondlayer/stacks@1.0.0-alpha.0

## 0.11.8

### Patch Changes

- Updated dependencies [[`ebea60d`](https://github.com/ryanwaits/secondlayer/commit/ebea60da47f6fd12d1052166aa929951f5a0cb2b), [`7567649`](https://github.com/ryanwaits/secondlayer/commit/756764942865fbcc6d98608861abfbda2e175a86), [`26c090c`](https://github.com/ryanwaits/secondlayer/commit/26c090ce6290ddc5cf42ea8b72e87e80c1a3e786), [`416f7c4`](https://github.com/ryanwaits/secondlayer/commit/416f7c4a53bcc7c96362f23c19e9b715622819d7), [`2605a4f`](https://github.com/ryanwaits/secondlayer/commit/2605a4fb3b558c942cddef2955709088f1c67450)]:
  - @secondlayer/shared@2.0.0

## 0.11.7

### Patch Changes

- Updated dependencies [[`4f1c7ea`](https://github.com/ryanwaits/secondlayer/commit/4f1c7eaa9242295972404174b24049c54d6b7a50), [`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955), [`7e1cf3d`](https://github.com/ryanwaits/secondlayer/commit/7e1cf3d4048b310c036ae30dac0d76f06d712375), [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1), [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3), [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01), [`696124e`](https://github.com/ryanwaits/secondlayer/commit/696124e115dc64d88eede394bbf422eb9a514849)]:
  - @secondlayer/shared@1.1.0
  - @secondlayer/stacks@0.3.0

## 0.11.6

### Patch Changes

- [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Server-side subgraph bundler + source capture, mirroring the workflows authoring loop.

  - **API**: new `POST /api/subgraphs/bundle` runs `bundleSubgraphCode` from `@secondlayer/bundler` and returns `{ name, version, sources, schema, handlerCode, sourceCode, bundleSize }`. `BundleSizeError → 413`, other failures → 400 with `code: "BUNDLE_FAILED"`. New `GET /api/subgraphs/:name/source` returns the original TypeScript source for deployed subgraphs, or a `readOnly` payload for rows predating the migration. `POST /api/subgraphs` now threads `sourceCode` through `deploySchema` so the original source is persisted on deploy.
  - **SDK**: new `subgraphs.bundle({ code })` and `subgraphs.getSource(name)` methods + `BundleSubgraphResponse` / `SubgraphSource` types.
  - **shared**: migration `0031_subgraph_source_code` adds `source_code TEXT NULL` to the `subgraphs` table; `registerSubgraph` upsert + `DeploySubgraphRequest` schema both accept an optional `sourceCode` field (max 1MB).
  - **subgraphs**: `deploySchema()` accepts `sourceCode` in its options and forwards it to `registerSubgraph`.

  Unlocks the next wave of the chat authoring loop (read/edit/deploy/tail subgraphs in a session).

- Updated dependencies [[`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5), [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9), [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7), [`38e62e7`](https://github.com/ryanwaits/secondlayer/commit/38e62e74e600c353884fc89a5e22b8840a4d2689), [`e9c298c`](https://github.com/ryanwaits/secondlayer/commit/e9c298c828770e8ff538b957a7d7f38a7753900f)]:
  - @secondlayer/shared@1.0.0

## 0.11.5

### Patch Changes

- record errors to total_errors/last_error during reindex block processing

## 0.11.4

### Patch Changes

- fix: use delete instead of undefined assignment for internal metadata keys to prevent them appearing as SQL columns

## 0.11.3

### Patch Changes

- fix \_tx_id attribution: capture at insert time instead of flush time to prevent cross-tx misattribution within a block

## 0.11.2

### Patch Changes

- fix schema diff false positives from JSONB key reordering; hot-reload handler code after redeploy; handle bigint in jsonb serialization

- Updated dependencies []:
  - @secondlayer/shared@0.12.2

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
