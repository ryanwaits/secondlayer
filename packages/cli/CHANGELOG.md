# @secondlayer/cli

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
