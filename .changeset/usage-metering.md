---
"@secondlayer/worker": minor
---

Usage metering for paid tenants.

Two new worker cron jobs push Stripe billing meter events with deterministic idempotency identifiers:

- **Hourly compute hours** (`compute-metering.ts`) — enumerates active tenants with a Stripe customer id, pushes `compute_hours` = `cpus × 1` per hour. Suspended tenants produce no events. Identifier `compute:<slug>:<yyyy-mm-ddThh>` so replays dedupe.
- **Daily storage overage** (`storage-metering.ts`) — for each active paid tenant where `storage_used_mb > storage_limit_mb`, pushes `storage_gb_months` prorated to 1/30 per day (Stripe SUMs to GB-months by period end). Enterprise unlimited (`storage_limit_mb = -1`) is exempt. Identifier `storage:<slug>:<yyyy-mm-dd>`.

Both crons no-op cleanly when `STRIPE_SECRET_KEY` is unset (local dev, OSS mode) or `INSTANCE_MODE` isn't `platform`. Hobby tenants skipped automatically — they never have a Stripe customer id (lazy customer creation).

AI eval metering (`ai_evals` meter) is wired at the meter level in the setup script but not yet emitted — lands with the workflow-runner revival.
