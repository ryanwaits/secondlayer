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

Deploy via CLI (`sl subgraphs deploy path/to/definition.ts`), SDK (`sl.subgraphs.deploy({...})`), or MCP (`subgraphs_deploy`). The dashboard is read-only — creation always happens through an API surface.

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
| `TENANT_PLAN` | unset | Dedicated hosting plan injected by the provisioner. `hobby` uses smaller reindex batches; unset and paid plans use standard batches. |
| `SUBGRAPH_REINDEX_BATCH_SIZE` | plan-based | Override the default historical block batch size used by reindex/backfill. |
| `SUBGRAPH_REINDEX_MIN_BATCH_SIZE` | plan-based | Override the adaptive lower bound for reindex/backfill batches. |
| `SUBGRAPH_REINDEX_MAX_BATCH_SIZE` | plan-based | Override the adaptive upper bound for reindex/backfill batches. |

## Postgres + pool mode

The emitter holds a persistent `LISTEN` on `subscriptions:new_outbox` and `subscriptions:changed`, so it MUST connect through a session-mode pool. pgbouncer in transaction mode silently breaks it. Run the emitter against a session-mode port (`pool_mode = session`), or connect directly to Postgres as the default docker-compose setup does.

## License

MIT
