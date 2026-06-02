---
"@secondlayer/clarity-docs": patch
---

Replace the repeated `t.name!` non-null assertions in the ClarityDoc tag extractors with a single `namedTags` type-guard filter helper, so `name` is narrowed to `string` by the compiler instead of suppressed via `biome-ignore`. No behavior change.
