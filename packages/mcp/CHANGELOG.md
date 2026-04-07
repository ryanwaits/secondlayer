# @secondlayer/mcp

## 0.4.0

### Minor Changes

- feat: add workflows support across packages

  - @secondlayer/sdk: add workflows client
  - @secondlayer/cli: add `sl workflows` commands
  - @secondlayer/mcp: add workflow tools for AI agents
  - @secondlayer/indexer: add tx repair script for missing function_args and raw_result

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.10.0

## 0.3.5

### Patch Changes

- 885662d: feat(subgraphs): named-object sources with SubgraphFilter discriminated union

  Breaking: sources changed from `SubgraphSource[]` to `Record<string, SubgraphFilter>`. Handler keys are now source names, not derived sourceKey strings. Event data auto-unwrapped via cvToValue. New context methods: patch, patchOrInsert, formatUnits, aggregates.

- Updated dependencies [885662d]
  - @secondlayer/subgraphs@0.9.0
  - @secondlayer/sdk@0.9.1

## 0.3.4

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@0.8.0
  - @secondlayer/sdk@0.9.0

## 0.3.3

### Patch Changes

- Updated dependencies [[`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757)]:
  - @secondlayer/subgraphs@0.7.0
  - @secondlayer/sdk@0.8.0

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.7.0
  - @secondlayer/subgraphs@0.6.0

## 0.3.1

### Patch Changes

- Migrate all zod imports from v3 compat layer to zod/v4 and fix type errors.

- Updated dependencies []:
  - @secondlayer/subgraphs@0.5.5

## 0.3.0

### Minor Changes

- Add structured error handling, 3 new tools (replay, rotate_secret, whoami), enhanced subgraphs_query, and 3 MCP resources.

## 0.2.1

### Patch Changes

- Fix npx resolution, version mismatch, and include README in published package.

## 0.2.0

### Minor Changes

- Initial release. 19 MCP tools: streams CRUD, subgraph deploy/query, scaffold, templates. Stdio and HTTP transports.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@0.5.4
