# @secondlayer/shared

Foundational utilities for Second Layer services: DB layer (Kysely+Postgres), job queue, Zod schemas, HMAC signing, Stacks node clients.

## Testing

```bash
# Run tests (DB tests skip without DATABASE_URL)
bun test

# Run with database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/streams_test bun test
```

## Migrations

```bash
DATABASE_URL=... bun run migrate
```
