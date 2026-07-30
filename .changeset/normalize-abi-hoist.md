---
"@secondlayer/stacks": minor
---

`normalizeAbi` / `normalizeAccess` / `normalizeType` now ship from `@secondlayer/stacks/clarity` (they were CLI-only). A raw Hiro API or Clarinet SDK ABI — `buffer` instead of `buff`, `read_only` instead of `read-only`, function outputs wrapped as `{ type: … }` — can be normalized anywhere, without the CLI installed, before it reaches anything that types off it.

`PrintFieldType` in `@secondlayer/stacks/filters` widens to match the subgraphs `PrintField` vocabulary (nested tuples, lists, optional fields), so a filter carrying a nested `prints` declaration still round-trips through `toSubgraphSource()`. New `PrintScalarType` export for the scalar-only subset.
