# @secondlayer/subgraphs

Typed on-chain indexing for Stacks. Declare event filters + column schema with `defineSubgraph()`; the runtime decodes blocks, matches filters, runs your handlers inside a transactional context, and exposes the result as a Postgres schema you query over REST or SQL.

Subgraph rows fan out to HTTP subscribers through a post-flush outbox emitter — signed Standard Webhooks POSTs with retries, circuit breaker, and replay.

## Install

```bash
bun add @secondlayer/subgraphs
```

## Quick Start

For the full hosted beta loop, including project setup, fast deploys with
`--start-block`, querying, and subscriptions, start with
[QUICKSTART.md](QUICKSTART.md).

```typescript
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "token-transfers",
  version: "1.0.0",
  sources: {
    // Named event sources — the key becomes the handler name.
    transfer: {
      type: "ft_transfer",
      assetIdentifier: "SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173.stx-token::stx",
    },
  },
  schema: {
    transfers: {
      columns: {
        sender: { type: "principal" },
        recipient: { type: "principal" },
        amount: { type: "uint" },
      },
      // Auto-added: _block_height, _tx_id, _created_at
    },
  },
  handlers: {
    async transfer(event, ctx) {
      ctx.insert("transfers", {
        sender: event.sender,
        recipient: event.recipient,
        amount: event.amount,
      });
    },
  },
});
```

Deploy via CLI (`sl subgraphs deploy path/to/definition.ts`), SDK (`sl.subgraphs.deploy({...})`), or MCP (`subgraphs_deploy`). The CLI can also scaffold from a deployed contract with `sl subgraphs scaffold <contract> -o subgraphs/name.ts`; scaffold writes or amends `package.json` and runs `bun install` unless `--no-install` is passed. The dashboard is read-only — creation always happens through an API surface.

## Exports

| Subpath | Description |
| --- | --- |
| `.` | `defineSubgraph`, `validateSubgraphDefinition`, `deploySchema`, `diffSchema`, `reindexSubgraph`, `backfillSubgraph`, `generateSubgraphSQL`, `pgSchemaName` |
| `./types` | All schema + filter + handler types (`SubgraphDefinition`, `SubgraphFilter`, `StxTransferFilter`, etc.) |
| `./schema` | Generator + deployer internals |
| `./validate` | Shape + filter validation for deploys |
| `./triggers` | Typed `on.*` helpers for all `SubgraphFilter` variants |
| `./runtime/source-matcher` | Pure fn: match txs+events against a `SubgraphFilter` — used by the processor hot path |
| `./runtime/replay` | `replaySubscription({ accountId, subscriptionId, fromBlock, toBlock })` — re-enqueue historical rows as outbox entries |

## Runtime components

The runtime ships behind these entrypoints (import from the package root):

- `startSubgraphProcessor(opts?)` — boots the block processor. LISTENs on `indexer:new_block`, matches sources, runs handlers, flushes writes inside a transaction, and emits outbox rows for matching subscriptions. Also boots the emitter worker.
- `processBlock(subgraph, name, height, opts?)` — single-block entry point used by catch-up, reindex, and tests.
- `catchUpSubgraph(def, name)` — drains pending blocks up to chain tip.
- `reindexSubgraph(def, opts)` — drop + rebuild schema tables from a start block. Breaking schema changes trigger this automatically on deploy.

## Subscription emitter

Every row written through `ctx.insert()` / `ctx.upsert()` is atomically enqueued to `subscription_outbox` for every active subscription whose filter matches — inside the same transaction as the flush, so a processor crash rolls back both.

The emitter drains the outbox via `LISTEN subscriptions:new_outbox` and `FOR UPDATE SKIP LOCKED` batch claims. Live deliveries win a 90/10 split over replays. Each row dispatches through the format builder matching the subscription's `format` column (`standard-webhooks`, `inngest`, `trigger`, `cloudflare`, `cloudevents`, `raw`). Retries follow `30s → 2m → 10m → 1h → 6h → 24h → 72h`. Twenty consecutive failures trips the per-sub circuit breaker and pauses the subscription.

Delivery bodies and response previews land in `subscription_deliveries`. Rows whose retries exhaust mark `status = 'dead'` in the outbox and surface in the dashboard's dead-letter queue for one-click requeue.

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `SECONDLAYER_EMIT_OUTBOX` | `true` | Set `false` to bypass outbox emission on every block (kill-switch). |
| `SECONDLAYER_ALLOW_PRIVATE_EGRESS` | `false` | Allow the emitter to deliver to private IP ranges (localhost, 10/8, 172.16/12, 192.168/16, link-local, v6 mapped). Leave off in production. |
| `SECONDLAYER_SECRETS_KEY` | — | 32-byte hex key for the AES-GCM envelope around subscription signing secrets. OSS mode auto-generates + persists to `.env.local`. |
| `TENANT_PLAN` | unset | Dedicated hosting plan injected by the provisioner. Unset and paid plans use standard batches. |
| `SUBGRAPH_REINDEX_BATCH_SIZE` | plan-based | Override the default historical block batch size used by reindex/backfill. |
| `SUBGRAPH_REINDEX_MIN_BATCH_SIZE` | plan-based | Override the adaptive lower bound for reindex/backfill batches. |
| `SUBGRAPH_REINDEX_MAX_BATCH_SIZE` | plan-based | Override the adaptive upper bound for reindex/backfill batches. |
| `DATABASE_MAX_POOLS` | `25` | Max cached connection pools. With BYO subgraphs (one pool per user DB) the least-recently-used pool is evicted past this cap; the source/target pools are never evicted. |
| `DATABASE_IDLE_TIMEOUT` | `300` | Seconds before idle connections are closed (`0` = never). Keeps a fleet of BYO pools from pinning connections. |

## Bring your own database (BYO data plane)

There are three tiers, not two:

| Tier | Indexer / decode | Handler exec | Database | Serving API |
| --- | --- | --- | --- | --- |
| Managed (default) | ours | ours | ours | ours |
| **BYO data plane** | ours | ours | **yours** | **yours** |
| Self-host | yours | yours | yours | yours |

With BYO, the managed pipeline (ingest → decode → match → run your handler) is
unchanged, but your handler's rows land in **your** Postgres and the serving API
reads from there. Deploy with a connection string:

```bash
sl subgraphs deploy subgraphs/my.ts --database-url "postgres://user:pass@your-host:5432/db"
```

The connection string is stored encrypted at rest (AES-GCM, keyed by
`SECONDLAYER_SECRETS_KEY`) and never returned in API responses. The server
verifies the connection before deploying. Once deployed, query the
`subgraph_…` schema directly with any ORM/GraphQL/REST — we're no longer in the
serving path.

**Preview before it touches your DB.** `POST /api/subgraphs` with
`{"dryRun": true, "databaseUrl": "…"}` returns the exact DDL plus a grant
script and verifies the connection — without writing anything.

**Constraints (v1):**

- **Idempotent handlers only.** A BYO block write can't share the managed
  transaction, so a crash replays the block (at-least-once). `ctx.insert` and
  `ctx.upsert` (with a unique key) are safe — flush is replace-per-height. A
  deploy with non-idempotent `ctx.update` / `ctx.patchOrInsert` is rejected.
- **No reindex.** Reindex would drop + rebuild the schema in your DB from a
  background job; instead, re-deploy to rebuild (or drop the schema yourself).
- **Delete leaves your data.** Deleting the subgraph removes our registry row
  (and the stored connection) and pauses subscriptions, but never drops the
  schema in your database.

**Recommended:** give Secondlayer a least-privilege role scoped to its own
schema, and point `--database-url` at a session-mode pooler endpoint
(PgBouncer/Neon/Supabase) rather than raw Postgres.

## Postgres + pool mode

The emitter holds a persistent `LISTEN` on `subscriptions:new_outbox` and `subscriptions:changed`, so it MUST connect through a session-mode pool. pgbouncer in transaction mode silently breaks it. Run the emitter against a session-mode port (`pool_mode = session`), or connect directly to Postgres as the default docker-compose setup does.

## License

MIT
