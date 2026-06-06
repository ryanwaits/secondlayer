---
"@secondlayer/subgraphs": minor
---

Add `generateIndexSchema(target, opts)` — emit a typed Kysely/Drizzle/JSON-Schema for the public Index domain tables (blocks, decoded events, transactions, stacking, sBTC, BNS, …) from `SOURCE_READ_TYPES`, so a BYO database mirror is fully typed and can't drift from the API. Prisma is intentionally unsupported (the read contract declares no primary key).
