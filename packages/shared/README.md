# @secondlayer/shared

Foundational utilities for Second Layer services: DB layer (Kysely + postgres-js), Zod schemas, crypto (Standard Webhooks signing, AES-GCM secret envelope), logger, pricing, env/mode utils, Stacks node clients.

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
| `@secondlayer/shared/db/queries/*` | Query helpers (integrity, accounts, usage, subgraphs, projects, subgraph-gaps, tenants, provisioning-audit) |
| `@secondlayer/shared/db/schema` | Database schema |
| `@secondlayer/shared/db/jsonb` | JSONB helpers |
| `@secondlayer/shared/schemas` | Zod schemas |
| `@secondlayer/shared/schemas/accounts` | Account profile schemas |
| `@secondlayer/shared/schemas/filters` | Event filter schemas |
| `@secondlayer/shared/schemas/subgraphs` | Subgraph schemas |
| `@secondlayer/shared/types` | Shared TypeScript types |
| `@secondlayer/shared/queue/listener` | Postgres LISTEN/NOTIFY helper (used for block notifications) |
| `@secondlayer/shared/env` | Environment config |
| `@secondlayer/shared/logger` | Logger |
| `@secondlayer/shared/errors` | Error types |
| `@secondlayer/shared/crypto` | HMAC helpers, Standard Webhooks signing, AES-GCM secret envelope |
| `@secondlayer/shared/pricing` | Plan definitions + billing helpers |
| `@secondlayer/shared/mode` | INSTANCE_MODE dispatch (platform / dedicated / oss) |
| `@secondlayer/shared/node` | Stacks node client |
| `@secondlayer/shared/node/hiro-pg-client` | Direct PG queries against Hiro DB |
