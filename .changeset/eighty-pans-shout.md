---
"@secondlayer/mcp": minor
"@secondlayer/sdk": patch
---

MCP: `codegen_index_schema` generates an ORM schema (kysely/prisma/drizzle/json-schema) for the Index tables without leaving the conversation — the same generator `sl codegen index` calls, so output is identical either way.

`get_contract_abi` is renamed `contracts_get_abi`. The old name had no product prefix, so the generated capability listing filed it under a phantom "get" product. The previous name stays callable as a deprecated alias until the next major.

SDK: `AGENTS.md` now ships in the published package — the five facts an agent can't infer from the types (keyless reads, opaque cursors, INCLUSIVE reorg rollback, rows and cursor in one transaction, `walk()` is not reorg-safe).
