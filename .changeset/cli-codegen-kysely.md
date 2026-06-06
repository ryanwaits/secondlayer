---
"@secondlayer/cli": minor
---

`sl subgraphs codegen --target kysely` now emits a Kysely schema (interfaces + `DB` registry) for a subgraph's tables, alongside the existing `prisma`/`drizzle` targets. The previous hard-rejection of `kysely` is removed.
