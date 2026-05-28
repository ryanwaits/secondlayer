---
"@secondlayer/subgraphs": minor
"@secondlayer/stacks": minor
"@secondlayer/shared": minor
"@secondlayer/cli": minor
---

Add ORM codegen and contract trait discovery.

`sl subgraphs codegen <file> --target prisma|drizzle` emits a typed ORM schema for a subgraph's tables — point it at your BYO database for a fully-typed Prisma/Drizzle client with relations (`@relation` / `relations()`), inferred row types, and FK constraints that mirror the deployed DDL. Kysely is supported via `kysely-codegen` against your database.

Contract trait discovery adds a contract registry that statically classifies deployed contracts against SIP-009/010/013 (by ABI shape inference and declared `impl-trait`s) and exposes `GET /v1/contracts?trait=sip-010&conformance=declared|inferred|any` to find every conforming contract.
