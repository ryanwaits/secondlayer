# @secondlayer/cli

## 2.1.0

### Minor Changes

- [`3b6d671`](https://github.com/ryanwaits/secondlayer/commit/3b6d6715bd16a317b8aa22dd6590aec3771b2d4e) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Add `sl workflows templates` subcommand. Run with no arguments to list all built-in workflow templates, or pass an id (e.g. `sl workflows templates whale-alert`) to print that template's source to stdout — pipe it into `workflows/<name>.ts` as a starting point.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/workflows@1.0.1

## 2.0.0

### Major Changes

- [#13](https://github.com/ryanwaits/secondlayer/pull/13) [`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Remove the streams product feature (real-time webhook deliveries) across the entire stack. Streams have been deprecated in favor of workflows + subgraphs.

  **Breaking changes:**

  - **SDK**: `client.streams.*` removed. `@secondlayer/sdk/streams` subpath export removed. `WorkflowSummary.triggerType` no longer accepts `"stream"`.
  - **CLI**: `sl streams *` commands removed (new, register, ls, get, set, logs, replay, rotate-secret, delete). `sl receiver`, `sl setup` commands removed. `sl status` / `sl doctor` no longer show stream/queue sections. `--wait` stop flags no longer drain a job queue.
  - **MCP**: `streams_*` tools removed. `workflows_scaffold` no longer accepts `type: "stream"` triggers. Stream filter MCP resource renamed to "event filter".
  - **API**: `/api/streams*` routes removed. `/api/logs/:id/stream` SSE endpoint removed. `/api/admin/stats` no longer returns `totalStreams`. `/api/accounts/usage` no longer returns `current.streams`. `/api/status` no longer returns queue/stream counts.
  - **Shared**: `StreamsTable`, `StreamMetricsTable`, `JobsTable`, `DeliveriesTable` dropped from `Database` interface. `@secondlayer/shared/queue` and `@secondlayer/shared/queue/recovery` subpaths removed. `@secondlayer/shared/db/queries/metrics` removed. `StreamNotFoundError` renamed to `NotFoundError`. `StreamsError` base class renamed to `SecondLayerError`. Dead subclasses `DeliveryError` and `FilterEvaluationError` removed. `StreamFilter` / `StreamFilterSchema` renamed to `EventFilter` / `EventFilterSchema`. `incrementDeliveries` removed (dead — no callers). `PlanLimits.streams` removed from `FREE_PLAN`.
  - **Worker**: stream processor, delivery dispatcher, signing, tracking, rate-limiter, and matcher all removed. Worker now runs only the scheduled storage-measurement job.
  - **Scaffold**: `generateStreamConfig` removed. Workflow trigger type no longer accepts `"stream"`.
  - **Workflows**: `StreamTrigger` type removed from `WorkflowTrigger` union.
  - **Workflow runner**: only `event` and `schedule` triggers are matched now.
  - **DB migration #32**: drops `streams`, `stream_metrics`, `jobs`, and `deliveries` tables. Renames PG NOTIFY channel from `streams:new_job` to `indexer:new_block`.

  **Bug fixes:**

  - CLI receiver was reading the wrong signature header (`x-streams-signature`) while the worker ships `X-Secondlayer-Signature`. The entire receiver is now removed.
  - Workflow scaffold paths (SDK + MCP + sessions) were emitting `type: "stream"` triggers that no longer typecheck against the workflows package.

### Patch Changes

- [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - Introduce `@secondlayer/bundler`: shared esbuild + validate helpers (`bundleSubgraphCode`, `bundleWorkflowCode`) with typed `BundleSizeError` and per-kind caps (subgraphs 4 MB, workflows 1 MB). MCP and CLI now consume it instead of inlining esbuild.
  - Persist workflow TypeScript source alongside the compiled handler (`workflow_definitions.source_code`, migration `0030`). `upsertWorkflowDefinition` bumps the patch version on every update and throws `VersionConflictError` when `expectedVersion` does not match the stored row.
  - Extend `DeployWorkflowRequestSchema` and the SDK/CLI deploy path with `sourceCode` + `expectedVersion`, so `sl workflows deploy` populates the new column and surfaces conflict detection.
- Updated dependencies [[`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5), [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9), [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7), [`d332f9c`](https://github.com/ryanwaits/secondlayer/commit/d332f9cb75638ff828ead721ce0e229100fd0e77), [`38e62e7`](https://github.com/ryanwaits/secondlayer/commit/38e62e74e600c353884fc89a5e22b8840a4d2689), [`eaa6115`](https://github.com/ryanwaits/secondlayer/commit/eaa61153f4a4247c42b132e022b5e972d2498883), [`e9c298c`](https://github.com/ryanwaits/secondlayer/commit/e9c298c828770e8ff538b957a7d7f38a7753900f), [`db333b1`](https://github.com/ryanwaits/secondlayer/commit/db333b1ea707516462f034ef13d37e5ff5fa01de)]:
  - @secondlayer/sdk@1.0.0
  - @secondlayer/shared@1.0.0
  - @secondlayer/workflows@1.0.0
  - @secondlayer/subgraphs@0.11.6
  - @secondlayer/bundler@0.2.0

## 1.12.2

### Patch Changes

- simplify gap display in subgraph status output

## 1.12.1

### Patch Changes

- fix(cli): only prompt confirmation for reindex, not fresh deploy

  Fresh deploys (new subgraph, no existing data) no longer show the destructive reindex confirmation prompt. The prompt now only appears when dropping and rebuilding existing data.

## 1.12.0

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
  - @secondlayer/subgraphs@0.11.0
  - @secondlayer/shared@0.12.0
  - @secondlayer/sdk@0.10.2
  - @secondlayer/workflows@0.0.3

## 1.11.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.11.0
  - @secondlayer/subgraphs@0.10.0
  - @secondlayer/sdk@0.10.1
  - @secondlayer/workflows@0.0.2

## 1.11.0

### Minor Changes

- feat: add workflows support across packages

  - @secondlayer/sdk: add workflows client
  - @secondlayer/cli: add `sl workflows` commands
  - @secondlayer/mcp: add workflow tools for AI agents
  - @secondlayer/indexer: add tx repair script for missing function_args and raw_result

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.10.0

## 1.10.1

### Patch Changes

- 885662d: feat(subgraphs): named-object sources with SubgraphFilter discriminated union

  Breaking: sources changed from `SubgraphSource[]` to `Record<string, SubgraphFilter>`. Handler keys are now source names, not derived sourceKey strings. Event data auto-unwrapped via cvToValue. New context methods: patch, patchOrInsert, formatUnits, aggregates.

- Updated dependencies [885662d]
  - @secondlayer/subgraphs@0.9.0
  - @secondlayer/shared@0.10.1
  - @secondlayer/sdk@0.9.1

## 1.10.0

### Minor Changes

- Deploy-resilient reindexing: abort support, auto-resume on startup, graceful shutdown, and `sl subgraphs stop` command.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.10.0
  - @secondlayer/subgraphs@0.8.0
  - @secondlayer/sdk@0.9.0

## 1.9.0

### Minor Changes

- Add 6-digit login code alongside magic link for dual auth (code entry + link click).

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.9.0
  - @secondlayer/sdk@0.8.1
  - @secondlayer/subgraphs@0.7.2

## 1.8.0

### Minor Changes

- [`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Add subgraph gap detection, tracking, and backfill across runtime, API, SDK, and CLI

### Patch Changes

- Updated dependencies [[`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757)]:
  - @secondlayer/shared@0.8.0
  - @secondlayer/subgraphs@0.7.0
  - @secondlayer/sdk@0.8.0

## 1.7.0

### Minor Changes

- Add `subgraphs.backfill()` SDK method and `sl subgraphs backfill` CLI command for non-destructive block range re-processing.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.7.0
  - @secondlayer/subgraphs@0.6.0
  - @secondlayer/shared@0.7.1

## 1.6.8

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.7.0
  - @secondlayer/sdk@0.6.4
  - @secondlayer/subgraphs@0.5.7

## 1.6.7

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.6.0
  - @secondlayer/stacks@0.2.2
  - @secondlayer/sdk@0.6.3
  - @secondlayer/subgraphs@0.5.6

## 1.6.6

### Patch Changes

- Migrate all zod imports from v3 compat layer to zod/v4 and fix type errors.

- Updated dependencies []:
  - @secondlayer/shared@0.5.1
  - @secondlayer/subgraphs@0.5.5

## 1.6.5

### Patch Changes

- Coerce numeric columns to BigInt in findOne/findMany results so arithmetic works correctly in handlers.

- Updated dependencies []:
  - @secondlayer/subgraphs@0.5.2

## 1.6.4

### Patch Changes

- CLI: bundle updated SDK with query response unwrap fix. Subgraphs: use NUMERIC for uint/int columns to handle Clarity values > bigint max.

- Updated dependencies []:
  - @secondlayer/subgraphs@0.5.1

## 1.6.3

### Patch Changes

- Serialize subgraph source objects to strings before sending to deploy API, fixing "Expected string, received object" error.

## 1.6.2

### Patch Changes

- Route ABI fetches through SecondLayer API proxy instead of Hiro public API.

## 1.6.1

### Patch Changes

- Prefer STACKS_NODE_RPC_URL over Hiro public API for ABI fetches in scaffold/generate commands.

## 1.6.0

### Minor Changes

- 4b716bd: Rename "views" product to "subgraphs" across entire codebase. Package `@secondlayer/views` is deprecated in favor of `@secondlayer/subgraphs`. All types, functions, API routes, CLI commands, and DB tables renamed accordingly.

### Patch Changes

- Updated dependencies [4b716bd]
  - @secondlayer/shared@0.5.0
  - @secondlayer/subgraphs@0.5.0
  - @secondlayer/sdk@0.6.0

## 1.5.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.5.0
  - @secondlayer/shared@0.4.0
  - @secondlayer/stacks@0.2.0
  - @secondlayer/views@0.3.0

## 1.5.0

### Minor Changes

- Replace session tokens with API keys as sole CLI credential. Login now creates a `cli-<hostname>` API key via temporary session, logout revokes it server-side, and sessionToken is removed from config.

## 1.4.1

### Patch Changes

- Updated dependencies [48e42ba]
- Updated dependencies [a070de2]
  - @secondlayer/shared@0.3.0
  - @secondlayer/stacks@0.1.0
  - @secondlayer/sdk@0.4.1
  - @secondlayer/views@0.2.4

## 1.4.0

### Minor Changes

- Add `getView()` standalone factory to `@secondlayer/sdk`. Mirrors `getContract()` — accepts a view def + plain options, `SecondLayer`, or `Views` instance; no `SecondLayer` instantiation required for view-only use cases.

  Generated `createClient` from `sl views generate` now takes `options?: { apiKey?: string; baseUrl?: string }` instead of `sl: SecondLayer`.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.4.0

## 1.3.0

### Minor Changes

- Add whoami command, --network global flag, hosted-mode doctor, testnet in setup wizard, shared 401 error handler with auth guidance, replace raw stdin with inquirer in auth login, hide local-only config for hosted users, improve webhook template, fix stale command references, remove duplicate top-level logs command

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.3.1

## 1.2.4

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.4
  - @secondlayer/shared@0.2.3
  - @secondlayer/views@0.2.3

## 1.2.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.3
  - @secondlayer/shared@0.2.2
  - @secondlayer/views@0.2.2

## 1.2.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.2
  - @secondlayer/shared@0.2.1
  - @secondlayer/views@0.2.1

## 1.2.1

### Patch Changes

- Restructure SDK into subpath exports (`@secondlayer/sdk/streams`, `@secondlayer/sdk/views`). Replace `StreamsClient` with `SecondLayer` class composing `Streams` and `Views` domain clients. Extract `BaseClient` abstract with shared request/auth logic. Default baseUrl to `https://api.secondlayer.io`.

- Updated dependencies []:
  - @secondlayer/sdk@0.3.0

## 1.2.0

### Minor Changes

- Migrate code formatter from Prettier to Biome JS API with import sorting and tabs

## 1.1.0

### Minor Changes

- feat(actions): optional senderKey with STX_SENDER_KEY env var fallback

## 1.0.0

### Major Changes

- BREAKING: Renamed all Stacks/Codegen references to SecondLayer
  - `StacksConfig` → `SecondLayerConfig`
  - `StacksCodegenPlugin` → `SecondLayerPlugin`
  - `StacksReactConfig` → `SecondLayerReactConfig`
  - `StacksProvider` → `SecondLayerProvider`
  - `useStacksConfig` → `useSecondLayerConfig`
  - `createStacksConfig` → `createSecondLayerConfig`
  - Config file: `stacks.config.ts` → `secondlayer.config.ts`

## 0.3.10

### Patch Changes

- Updated dependencies []:
  - @secondlayer/clarity-types@0.5.0

## 0.3.9

### Patch Changes

- fix: consolidated audit fixes - config regex, missing imports, type validation, error handling, code deduplication

- Updated dependencies []:
  - @secondlayer/clarity-types@0.4.2

## 0.3.8

### Patch Changes

- Fix generated code linting: map Clarity `none` type to TypeScript `null` instead of `any`

  This fixes Biome and other linter warnings for response types like `{ ok: null } | { err: bigint }` in generated constant getters.

## 0.3.7

### Patch Changes

- Hardening improvements based on audit findings:
  - Add composite type validation for lists (max length), tuples (required fields), and responses (ok/err shape)
  - Create ABI normalization layer for format compatibility (buffer/buff, read_only/read-only)
  - Enhance principal validation with contract name format checking
  - Consolidate type mapping utilities into shared module
  - Remove @secondlayer/clarity-types dependency from generated code for better DX
  - Inline validation utilities in generated code (CONTRACT_NAME_REGEX)

## 0.3.6

### Patch Changes

- Add composite type validation and consolidate shared utilities

  - Add validation for lists (max length), tuples (required fields), and responses (ok/err shape)
  - Add contract name format validation for principals
  - Create ABI normalization layer for buffer/buff and read_only/read-only compatibility
  - Consolidate toCamelCase implementations into clarity-types
  - Consolidate type mapping utilities into shared module

- Updated dependencies []:
  - @secondlayer/clarity-types@0.4.1

## 0.3.5

### Patch Changes

- Updated dependencies []:
  - @secondlayer/clarity-types@0.4.0

## 0.3.4

### Patch Changes

- Simplify generate command output to single success message

## 0.3.3

### Patch Changes

- Fix contractName to use original kebab-case for API calls while keeping camelCase for JS exports
  - Preserve `_directFile` flag through contract config transformation
  - Extract original contract name from address for API endpoints (vars, constants, maps)
  - Maintains `sbtcToken` for JS imports but uses `sbtc-token` for API URLs

## 0.3.2

### Patch Changes

- Fix lint issues in generated code and improve dependency DX
  - Remove useless else clauses after return statements (noUselessElse)
  - Replace control character regex with charCodeAt for ASCII detection (noControlCharactersInRegex)
  - Add warning when @stacks/transactions peer dependency is missing
  - Add @requires JSDoc tag to generated file header

## 0.3.1

### Patch Changes

- Auto-infer network from contract address prefix (SP/SM = mainnet, ST/SN = testnet) for maps, variables, constants, and read helpers. Network parameter is now optional with explicit override still supported for devnet testing.

## 0.3.0

### Minor Changes

- Add support for contract state (maps, variables, and constants)
  - Generate typed `maps` object with `get()` methods for reading map entries via Hiro API
  - Generate typed `vars` object with `get()` methods for reading data variables
  - Generate typed `constants` object with `get()` methods for reading contract constants
  - Add React hooks for maps (`useContractMapName`), variables (`useContractVarName`), and constants (`useContractConstantName`)
  - Constants hooks use `staleTime: Infinity` since values never change
  - Parse maps and variables from Hiro API contract interface responses

### Patch Changes

- Fix type safety for complex Clarity types in React hooks

  - Fix `mapClarityTypeToTS` to properly handle response, tuple, list, and optional types
  - React hooks now return proper TypeScript types instead of `any` for complex return values
  - Fix PostCondition types (use `PostCondition[]` instead of `any[]`)
  - Add proper parentheses for union types in list contexts (e.g., `(string | null)[]`)

- Updated dependencies []:
  - @secondlayer/clarity-types@0.3.0

## 0.2.5

### Patch Changes

- Fix issue with CommonJS bundling

- Updated dependencies []:
  - @secondlayer/clarity-types@0.2.2

## 0.2.4

### Patch Changes

- Clean up eager imports and heavy deps

- Updated dependencies []:
  - @secondlayer/clarity-types@0.2.1

## 0.2.3

### Patch Changes

- Fix --version flag to read version dynamically from package.json

## 0.2.2

### Patch Changes

- Replace Bun.Glob with fast-glob for Node.js compatibility

## 0.2.1

### Patch Changes

- Fix workspace dependency resolution for @secondlayer/clarity-types

## 0.2.0

### Minor Changes

- Initial monorepo release. The CLI now includes a new testing plugin for Clarinet SDK integration, and type inference is powered by the new @secondlayer/clarity-types package with runtime validation guards and value converters.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/clarity-types@0.2.0
