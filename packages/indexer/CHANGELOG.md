# @secondlayer/indexer

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.6.0
  - @secondlayer/stacks@0.2.2

## 0.3.0

### Minor Changes

- 4b716bd: Rename "views" product to "subgraphs" across entire codebase. Package `@secondlayer/views` is deprecated in favor of `@secondlayer/subgraphs`. All types, functions, API routes, CLI commands, and DB tables renamed accordingly.

### Patch Changes

- Updated dependencies [4b716bd]
  - @secondlayer/shared@0.5.0

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.4.0
  - @secondlayer/stacks@0.2.0

## 0.2.0

### Minor Changes

- 04e4a49: Local-first block sourcing: tip-follower, integrity auto-backfill, and bulk-backfill try local DB before Hiro remote. Parser stores tx_index, API decode fallback now opt-in via ENABLE_TX_DECODE_FALLBACK.

### Patch Changes

- Updated dependencies [48e42ba]
- Updated dependencies [a070de2]
  - @secondlayer/shared@0.3.0
  - @secondlayer/stacks@0.1.0

## 0.1.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.4
  - @secondlayer/shared@0.2.3

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.3
  - @secondlayer/shared@0.2.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.2
  - @secondlayer/shared@0.2.1
