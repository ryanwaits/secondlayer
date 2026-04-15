# @secondlayer/shared

Foundational utilities for Second Layer services: DB layer (Kysely+Postgres), Zod schemas, HMAC signing, Stacks node clients.

## Testing

```bash
# Run tests (DB tests skip without DATABASE_URL)
bun test

# Run with database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/secondlayer_test bun test
```

## Migrations

```bash
DATABASE_URL=... bun run migrate
```

## Exports

| Path | Description |
|------|-------------|
| `@secondlayer/shared` | Core utilities |
| `@secondlayer/shared/db` | Kysely database layer |
| `@secondlayer/shared/db/queries/*` | Query helpers (integrity, metrics, accounts, usage, subgraphs) |
| `@secondlayer/shared/db/schema` | Database schema |
| `@secondlayer/shared/db/jsonb` | JSONB helpers |
| `@secondlayer/shared/schemas` | Zod schemas |
| `@secondlayer/shared/schemas/filters` | Event filter schemas |
| `@secondlayer/shared/schemas/subgraphs` | Subgraph schemas |
| `@secondlayer/shared/types` | Shared TypeScript types |
| `@secondlayer/shared/queue/listener` | Queue listener |
| `@secondlayer/shared/env` | Environment config |
| `@secondlayer/shared/logger` | Logger |
| `@secondlayer/shared/errors` | Error types |
| `@secondlayer/shared/crypto` | HMAC signing |
| `@secondlayer/shared/node` | Stacks node client |
| `@secondlayer/shared/node/hiro-pg-client` | Direct PG queries against Hiro DB |
| `@secondlayer/shared/lib/plans` | Plan definitions |
