---
"@secondlayer/shared": minor
---

Make `migrate.ts` split-aware. `migrationTargets()` now tags each database with a plane role (`source` / `target` / `both`) and `setMigrationRole()` is set before each pass; new helpers `onControlPlane()` / `onChainPlane()` (exported from `@secondlayer/shared/db`) gate DDL inside a migration so control-plane DDL no-ops on the SOURCE (chain) DB — where those tables were dropped post-cutover — and chain DDL no-ops on TARGET. Single-DB / collapsed-split mode resolves to role `both` and is unchanged. Every migration still runs on every DB (kysely integrity preserved); only the DDL is gated.
