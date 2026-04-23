# @secondlayer/clarity-docs

## 0.3.7-alpha.0

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@1.0.0-alpha.0

## 0.3.6

### Patch Changes

- Updated dependencies [[`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955), [`7e1cf3d`](https://github.com/ryanwaits/secondlayer/commit/7e1cf3d4048b310c036ae30dac0d76f06d712375), [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1), [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3), [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01), [`696124e`](https://github.com/ryanwaits/secondlayer/commit/696124e115dc64d88eede394bbf422eb9a514849)]:
  - @secondlayer/stacks@0.3.0

## 0.3.5

### Patch Changes

- Fix TypeScript configuration errors in bunup config.

- Updated dependencies []:
  - @secondlayer/stacks@0.2.0

## 0.3.4

### Patch Changes

- Updated dependencies [a070de2]
  - @secondlayer/stacks@0.1.0

## 0.3.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.4

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.3

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.2

## 0.3.0

### Minor Changes

- Simplify callers array to optional caller string, fix continuation line bug in stripDocs

  Breaking: `callers: string[]` → `caller?: string` on FunctionDoc and JSON output

  - Single authorization statement is more natural than array
  - Matches semantic expectation (compound statement vs multiple conditions)

  Bug fix: stripSelectiveDocs now preserves continuation lines for kept tags

  - Previously dropped lines like `;;  continued here`
  - Added `inKeptTag` state tracking

  SIP updates:

  - Added localization section to Appendix D
  - Added Trait Tags section with examples
  - Formalized @prints grammar with type annotations

## 0.2.1

### Patch Changes

- fix clarity-types dependency to use explicit version

## 0.2.0

### Minor Changes

- Add clarity-docs package for parsing and generating Clarity documentation
