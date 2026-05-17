---
"@secondlayer/shared": patch
"@secondlayer/cli": patch
---

Subscription delivery integrity fixes:

- New migration `0077` loosens `subscription_deliveries.outbox_id` FK from `ON DELETE CASCADE` to `ON DELETE SET NULL`. Outbox cleanup races no longer 23503 the delivery insert, which previously snowballed circuit_failures and auto-paused subscriptions.
- `sl subscriptions delete <name>` is now idempotent — a second delete prints "already deleted" instead of `500 Server error`.
- `sl subscriptions get` now shows the backoff curve (30s → 2m → 10m → 1h → 6h → 24h → 72h) alongside Max Retries / Timeout / Concurrency.
