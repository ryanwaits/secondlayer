---
"@secondlayer/shared": minor
---

Add `TABLE_TO_DB` (exported from `@secondlayer/shared/db`) — a canonical, type-enforced (`satisfies Record<keyof Database, "source"|"target"|"both">`) registry mapping every table to its plane in the source/target split. It's the single source of truth that `docker/SCHEMA_SPLIT.md` and the cutover script's `CONTROL_TABLES` mirror, guarded by a drift test.
