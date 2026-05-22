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
| `@secondlayer/shared` | Core utilities (errors, logger, env, db layer, subgraph/subscription schemas) |
| `@secondlayer/shared/db` | Kysely database layer |
| `@secondlayer/shared/db/schema` | Database schema + row types |
| `@secondlayer/shared/db/queries/*` | Query helpers (integrity, chain-reorgs, subgraphs, subgraph-gaps, subgraph-operations, subscriptions) |
| `@secondlayer/shared/schemas` | Zod schemas (subgraphs, subscriptions) |
| `@secondlayer/shared/schemas/subgraphs` | Subgraph schemas |
| `@secondlayer/shared/schemas/subscriptions` | Subscription schemas |
| `@secondlayer/shared/subgraphs/spec` | Subgraph spec generation |
| `@secondlayer/shared/queue/listener` | Postgres LISTEN/NOTIFY helper (used for block notifications) |
| `@secondlayer/shared/logger` | Logger |
| `@secondlayer/shared/errors` | Error types |
| `@secondlayer/shared/mode` | INSTANCE_MODE dispatch (platform / dedicated / oss) |
| `@secondlayer/shared/crypto/secrets` | AES-GCM secret envelope |
| `@secondlayer/shared/crypto/standard-webhooks` | Standard Webhooks signing |
| `@secondlayer/shared/node` | Stacks node client |
| `@secondlayer/shared/node/*` | Stacks node clients (hiro-client, local-client, hiro-pg-client, archive-client) |
