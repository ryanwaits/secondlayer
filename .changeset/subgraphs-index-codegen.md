---
"@secondlayer/subgraphs": minor
---

Add `generateIndexSchema(target, opts)` — emit a typed Prisma/Kysely/Drizzle/JSON-Schema for the public Index domain tables (blocks, decoded events, transactions, stacking, sBTC, BNS, …) from `SOURCE_READ_TYPES`, so a BYO database mirror is fully typed and can't drift from the API. Prisma uses `SOURCE_READ_PKS` for model identity; tables with no read-set primary key (e.g. chain_reorgs) are omitted from Prisma output but emitted by the other targets.
