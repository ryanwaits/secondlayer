# @secondlayer/subgraphs

Typed on-chain indexing for Stacks. Declare event filters + column schema with `defineSubgraph()`; the runtime decodes blocks, matches filters, runs your handlers inside a transactional context, and exposes the result as a Postgres schema you query over REST or SQL.

Subgraph rows fan out to HTTP subscribers through a post-flush outbox emitter — signed Standard Webhooks POSTs with retries, circuit breaker, and replay.

## Install

```bash
bun add @secondlayer/subgraphs
```

## Quick Start

```typescript
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "token-transfers",
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

Deploy via CLI (`secondlayer subgraphs deploy path/to/definition.ts`), SDK (`sl.subgraphs.deploy({...})`), or MCP (`subgraphs_deploy`). The CLI can also scaffold from a deployed contract with `secondlayer subgraphs scaffold <contract> -o subgraphs/name.ts`; scaffold writes or amends `package.json` and runs `bun install` unless `--no-install` is passed. The dashboard is read-only — creation always happens through an API surface.

## Exports

| Subpath | Description |
| --- | --- |
| `.` | `defineSubgraph`, `validateSubgraphDefinition`, `deploySchema`, `diffSchema`, `generateSubgraphSQL`, `pgSchemaName` |
| `./types` | All schema + filter + handler types (`SubgraphDefinition`, `SubgraphFilter`, `StxTransferFilter`, etc.) |
| `./schema` | Generator + deployer internals |
| `./validate` | Shape + filter validation for deploys |
| `./runtime/replay` | `replayWebhook({ accountId, webhookId, fromBlock, toBlock })` — re-enqueue historical rows as outbox entries |

## Runtime

The processor runs as a service, not a library import: `bun run packages/subgraphs/src/service.ts` (the `subgraph-processor` container in `docker/`). It LISTENs on `indexer:new_block`, matches sources, runs handlers, flushes writes inside a transaction, and emits outbox rows for matching webhooks. Breaking schema changes trigger a reindex on deploy.

## Webhook emitter

Every row written through `ctx.insert()` / `ctx.upsert()` is atomically enqueued to `webhook_outbox` for every active webhook whose filter matches — inside the same transaction as the flush, so a processor crash rolls back both.

The emitter drains the outbox via `LISTEN webhooks:new_outbox` and `FOR UPDATE SKIP LOCKED` batch claims. Live deliveries win a 90/10 split over replays. Each row dispatches through the format builder matching the webhook's `format` column (`standard-webhooks`, `inngest`, `trigger`, `cloudflare`, `cloudevents`, `raw`). Retries follow `30s → 2m → 10m → 1h → 6h → 24h → 72h`. Twenty consecutive failures trips the per-sub circuit breaker and pauses the webhook.

Delivery bodies and response previews land in `webhook_deliveries`. Rows whose retries exhaust mark `status = 'dead'` in the outbox and surface in the dashboard's dead-letter queue for one-click requeue.

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `SECONDLAYER_EMIT_OUTBOX` | `true` | Set `false` to bypass outbox emission on every block (kill-switch). |
| `SECONDLAYER_ALLOW_PRIVATE_EGRESS` | `false` | Allow the emitter to deliver to private IP ranges (localhost, 10/8, 172.16/12, 192.168/16, link-local, v6 mapped). Leave off in production. |
| `SECONDLAYER_SECRETS_KEY` | — | 32-byte hex key for the AES-GCM envelope around webhook signing secrets. OSS mode auto-generates + persists to `.env.local`. |
| `SUBGRAPH_REINDEX_BATCH_SIZE` | adaptive | Override the default historical block batch size used by reindex/backfill. |
| `SUBGRAPH_REINDEX_MIN_BATCH_SIZE` | adaptive | Override the adaptive lower bound for reindex/backfill batches. |
| `SUBGRAPH_REINDEX_MAX_BATCH_SIZE` | adaptive | Override the adaptive upper bound for reindex/backfill batches. |
| `DATABASE_MAX_POOLS` | `25` | Max cached connection pools; the least-recently-used pool is evicted past this cap. The source/target pools are never evicted. |
| `DATABASE_IDLE_TIMEOUT` | `300` | Seconds before idle connections are closed (`0` = never). |

## ORM codegen

Once rows land in your DB, generate a typed schema for your ORM:

```bash
secondlayer codegen subgraph subgraphs/my.ts --target prisma  -o prisma/schema.prisma
secondlayer codegen subgraph subgraphs/my.ts --target drizzle -o db/schema.ts
```

Prisma and Drizzle have first-class generators (`generatePrismaSchema` /
`generateDrizzleSchema` are exported). For Kysely, run `kysely-codegen`
against the DB.
Output mirrors the deployed DDL — `prisma db pull` should be a no-op; treat the
tables as read-only (the processor owns them) and never `migrate`/`push`.
`uint`→`Decimal`/`numeric` and the `BigInt` id need `.toString()` for JSON.

## Trait-scoped sources

A source can target a SIP standard instead of a fixed contract — it indexes
every contract the registry classifies as that standard (incl. ones deployed
later):

```ts
sources: {
  tokens: { type: "ft_transfer", trait: "sip-010" }, // all SIP-010 tokens
}
```

`trait` (`sip-009` | `sip-010` | `sip-013`) is supported on FT/NFT/`contract_call`/
`print_event` filters and composes (AND) with other fields. Token filters match
the asset-identifier's contract; `contract_call`/`print` match `contract_id`.
Resolution is as-of-block, so a reindex backfills a contract's full history even
if it was classified after deploy. Requires the contract registry to be
populated. Discover the set via `GET /v1/contracts?trait=sip-010`.

## Postgres + pool mode

The emitter holds a persistent `LISTEN` on `webhooks:new_outbox` and `webhooks:changed`, so it MUST connect through a session-mode pool. pgbouncer in transaction mode silently breaks it. Run the emitter against a session-mode port (`pool_mode = session`), or connect directly to Postgres as the default docker-compose setup does.

## License

MIT
