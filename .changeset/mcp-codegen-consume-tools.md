---
"@secondlayer/mcp": minor
---

Add two agent-native tools. `subgraphs_codegen` generates a Prisma/Drizzle/Kysely ORM schema for a subgraph's tables (from inline `code` or a deployed `name`'s captured source), closing the author→deploy→typed-ORM loop without the CLI. `streams_consume` is a bounded, reorg-aware consume/resume primitive — walks up to maxPages from a cursor and returns the events, observed reorgs, and a resume cursor.
