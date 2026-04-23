---
"@secondlayer/subgraphs": minor
"@secondlayer/shared": patch
---

Subscription emitter lands — the end-to-end delivery loop.

- `SubgraphContext.flush()` now returns a `FlushManifest` describing every write. Existing callers ignoring the return value keep working.
- `emitSubscriptionOutbox()` runs inside the block-processor transaction: matches each write against active subscriptions, inserts outbox rows (bulk `INSERT ... ON CONFLICT DO NOTHING` on `(subscription_id, dedup_key)` for idempotent replays). Bypassed when `SECONDLAYER_EMIT_OUTBOX=false`.
- `startEmitter()` boots alongside `startSubgraphProcessor`. `LISTEN subscriptions:new_outbox` + `LISTEN subscriptions:changed`, `FOR UPDATE SKIP LOCKED LIMIT 50` batch claim, per-sub in-memory concurrency semaphore (default 4), HTTP dispatch via Standard Webhooks format with AbortSignal timeout, `subscription_deliveries` attempt log truncated to 8KB. Circuit breaker trips at 20 consecutive failures → sub `paused`. Backoff 30s → 2m → 10m → 1h → 6h → 24h → 72h. Retention sweep hourly.
- Dashboard subscription detail page polls the last 100 deliveries every 5s.
- Emitter requires session-mode PG connection — pgbouncer transaction mode breaks the persistent LISTEN. Document in migration guide.
