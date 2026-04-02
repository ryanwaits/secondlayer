# @secondlayer/cli

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
