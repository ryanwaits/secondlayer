# @secondlayer/sdk

## 0.6.2

### Patch Changes

- fix(subgraphs): fix Zod v4 type cast in validate.ts
  chore(sdk): remove dangling ./contracts export
- Updated dependencies []:
  - @secondlayer/subgraphs@0.5.3

## 0.6.1

### Patch Changes

- Fix subgraph queryTable to unwrap `data` field from API response.

## 0.6.0

### Minor Changes

- 4b716bd: Rename "views" product to "subgraphs" across entire codebase. Package `@secondlayer/views` is deprecated in favor of `@secondlayer/subgraphs`. All types, functions, API routes, CLI commands, and DB tables renamed accordingly.

### Patch Changes

- Updated dependencies [4b716bd]
  - @secondlayer/shared@0.5.0
  - @secondlayer/subgraphs@0.5.0

## 0.5.0

### Minor Changes

- Add SDK README with comprehensive examples. Fix error serialization for non-string bodies. Validate orderBy accepts only single column. Handle limit=0 correctly in listDeliveries. Remove Contracts client in favor of views system.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.4.0
  - @secondlayer/views@0.3.0

## 0.4.1

### Patch Changes

- Updated dependencies [48e42ba]
  - @secondlayer/shared@0.3.0
  - @secondlayer/views@0.2.4

## 0.4.0

### Minor Changes

- Add `getView()` standalone factory to `@secondlayer/sdk`. Mirrors `getContract()` — accepts a view def + plain options, `SecondLayer`, or `Views` instance; no `SecondLayer` instantiation required for view-only use cases.

  Generated `createClient` from `sl views generate` now takes `options?: { apiKey?: string; baseUrl?: string }` instead of `sl: SecondLayer`.

## 0.3.1

### Patch Changes

- Fix API base URL (secondlayer.io → secondlayer.tools)

## 0.3.0

### Minor Changes

- Restructure SDK into subpath exports (`@secondlayer/sdk/streams`, `@secondlayer/sdk/views`). Replace `StreamsClient` with `SecondLayer` class composing `Streams` and `Views` domain clients. Extract `BaseClient` abstract with shared request/auth logic. Default baseUrl to `https://api.secondlayer.io`.

## 0.2.0

### Minor Changes

- Add @secondlayer/sdk - TypeScript client for SecondLayer API with stream management, view queries, and queue stats
