---
"@secondlayer/shared": minor
---

Add `SOURCE_READ_TYPES` — the portable column type (text/int/boolean/timestamp/jsonb + nullability) for every column in `SOURCE_READ_COLUMNS`, single-sourced from the `Database` interface. Powers typed codegen for the public Index domain. A drift test asserts it covers exactly `SOURCE_READ_COLUMNS`.
