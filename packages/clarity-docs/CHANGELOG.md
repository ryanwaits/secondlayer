# @secondlayer/clarity-docs

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
