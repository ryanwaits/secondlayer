---
"@secondlayer/api": patch
---

Fix `GET /v1/contracts` 500 in prod: the route read from the control/target DB via `getDb()`, but `contracts` is a source-plane table (`TABLE_TO_DB.contracts === "source"`), so with the DB split live the target had no `contracts` table. Read from `getSourceDb()` like every other source-plane reader. This also restores the `contracts_find` agent path.
