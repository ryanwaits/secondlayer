---
"@secondlayer/shared": minor
---

Add `SOURCE_READ_TYPES` (portable column type per read column) and `SOURCE_READ_PKS` (primary key per read table) — both single-sourced from the `Database` interface and drift-tested against `SOURCE_READ_COLUMNS`. These power typed codegen for the public Index domain (`SOURCE_READ_PKS` gives Prisma a model identity; tables with only a synthetic-id PK excluded from the read contract map to `null`).
