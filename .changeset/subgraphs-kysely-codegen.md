---
"@secondlayer/subgraphs": minor
---

Add `generateKyselySchema` (the Kysely arm of codegen, alongside Prisma/Drizzle). Emits per-table interfaces + a `DB` registry keyed by schema-qualified table name, so a BYO database gets fully-typed Kysely query building over decoded subgraph rows. Lossless numeric/bigint as `string`, mirroring the deployed DDL.
