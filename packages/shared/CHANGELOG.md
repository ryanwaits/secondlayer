# @secondlayer/shared

## 3.0.0

### Major Changes

- [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Drop workflow + sentry tables, query helpers, and schemas. Migration 0056 demolishes residual tables (`workflow_runs`, `workflow_steps`, `workflow_queue`, `workflow_ai_usage_daily`, `sentries`, `sentry_alerts`, `tx_confirmed_notify`).

### Minor Changes

- GA — stable release.

  Subgraphs + subscriptions + stacks SDK + MCP + CLI scaffolder all land on `latest` dist-tag:

  - `@secondlayer/sdk@3.0.0` — `sl.subgraphs.*` + `sl.subscriptions.*` (CRUD, rotateSecret, replay, dead-letter requeue, recent deliveries)
  - `@secondlayer/shared@3.0.0` — tables + queries for subgraphs, subscriptions, outbox, deliveries; Standard Webhooks helper; OSS secrets bootstrap
  - `@secondlayer/subgraphs@1.0.0` — typed subgraph runtime + post-flush emitter with LISTEN, FOR UPDATE SKIP LOCKED, per-sub concurrency, circuit breaker, backoff, 6-format dispatcher, replay, retention, SSRF egress guard
  - `@secondlayer/stacks@1.0.0` — viem-style Stacks client; workflow-runner-era broadcast/tx/ui surfaces removed
  - `@secondlayer/mcp@2.0.0` — subgraph + subscription tools (including replay + recent_deliveries)
  - `@secondlayer/cli@3.2.0` — `sl create subscription --runtime <inngest|trigger|cloudflare|node>` scaffolder

  Perf baseline (200 blocks × 20 subs, local): `emitMs` p95 ≈ 52ms, `deliveryMs` p95 ≈ 6ms, 100% delivery rate. Failure modes tested: receiver-kill mid-batch, processor tx rollback, clock-skew replay-attack reject. SSRF guard on by default (opt-out via `SECONDLAYER_ALLOW_PRIVATE_EGRESS=true` for self-host + local dev).

  Previous workflow-era `@secondlayer/sdk@2.0.0` and earlier remain on npm but are not the default `latest` anymore.

- [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Pricing foundation (Sprint A) — switch from 14-day trial to activity-based auto-pause, org-level billing prep.

  - Migration 0046 drops `tenants.trial_ends_at` + index, adds `tenants.last_active_at timestamptz NOT NULL DEFAULT now()` with index `(plan, last_active_at) WHERE status = 'active'`
  - Migration 0047 adds nullable `tenant_id` to `usage_daily` (+ best-effort backfill for single-tenant accounts), widens the unique key to `(account_id, tenant_id, date)` so Sprint-C Stripe metering can bill per-tenant
  - `TrialExpiredError` + `TRIAL_EXPIRED` code dropped (dead after trial removal)
  - New `bumpTenantActivity(slug)` + `listIdleHobbyTenants(idleSince)` query helpers
  - CLI drops trial-days-left from `sl instance info` and `sl whoami`, drops `TRIAL_EXPIRED` handlers

- [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Pricing Sprint C.1 — decouple compute from plan for add-ons.

  - Migration 0048 adds `tenant_compute_addons` table. Each row = one add-on bundle (memory/cpu/storage deltas with optional effective window + Stripe subscription_item_id). Effective compute = plan base + SUM(active deltas).
  - New `@secondlayer/shared/db/queries/tenant-compute-addons` module: `listActiveAddonsForTenant`, `computeEffectiveCompute(tenantId, base)`.
  - `@secondlayer/provisioner` breaking changes:
    - `resizeTenant(slug, planId)` → `resizeTenant(slug, { plan, totalCpus, totalMemoryMb, storageLimitMb })`. Plan stays as a label; sizing is explicit.
    - `getTenantStatus(slug, plan)` → `getTenantStatus(slug, plan, storageLimitMb)`. Caller passes the effective storage limit from the tenants row.
    - `rotateTenantKeys` preserves existing container sizing by reading from `docker inspect` instead of recomputing from the plan — so it stays correct for tenants with add-ons.
    - `POST /tenants/:slug/resize` body shape: `{ plan, totalCpus, totalMemoryMb, storageLimitMb }`.
    - `GET /tenants/:slug` now reads `storageLimitMb` query param.
  - New exported `allocForTotals(totalMemoryMb, totalCpus)` from `packages/provisioner/src/plans.ts` — auto-biases to PG-heavy split below 1 GB, default split above.
  - Platform API `POST /api/tenants/me/resize` now composes plan base + active add-ons via `computeEffectiveCompute` before calling the provisioner. `tenants.cpus/memory_mb/storage_limit_mb` cache the effective values for dashboard + billing.
  - Add-on CRUD + Stripe wiring land in Sprint C.2/C.3; this sprint is data-model + plumbing only.

- [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Soft spend caps with 80% threshold alerts — the core anti-surprise-bill differentiator.

  - Migration 0050 adds `account_spend_caps` table (one row per account): monthly + per-line (compute/storage/ai) caps in cents, configurable `alert_threshold_pct` (default 80), `frozen_at`, `alert_sent_at`.
  - New `@secondlayer/shared/db/queries/account-spend-caps` module: `getCaps`, `upsertCaps`, `freezeAccount`, `clearFreeze`, `listFrozenAccountIds`.
  - Worker cron `spend-cap-alert.ts` runs daily: fetches each paid account's upcoming invoice, sends a Resend email at threshold, sets `frozen_at` at 100%. Alert email debounced per billing cycle via `alert_sent_at` comparison to `period_start`.
  - Compute + storage metering crons now read `listFrozenAccountIds` at the top of each tick and skip frozen accounts entirely. Capped accounts keep running but stop accruing billable usage until the next cycle.
  - Stripe `invoice.paid` webhook clears `frozen_at` + `alert_sent_at` on the paying account, unfreezing metering for the new cycle.
  - Session-authed dashboard endpoints `GET /api/billing/caps` + `PATCH /api/billing/caps`. Raising a monthly cap mid-cycle auto-clears an active freeze (user explicitly said "yes, bill more").

- [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Lay Stripe billing foundation on the platform control plane.

  - Migration 0049 adds nullable `accounts.stripe_customer_id` with a partial unique index (ignores NULLs so Hobby users stay out of Stripe entirely — customer records materialize on first upgrade).
  - New `setStripeCustomerId(accountId, id)` query helper + `stripe_customer_id` on the `Account` type.
  - Platform API gains a lazy Stripe SDK singleton (`packages/api/src/lib/stripe.ts`), webhook endpoint (`POST /api/webhooks/stripe`) with raw-body signature verification + audit trail, and session-authed billing routes (`POST /api/billing/upgrade`, `GET /api/billing/portal`) that lazy-create the Stripe customer on first upgrade and return Checkout/Portal URLs.
  - Idempotent setup script (`bun run stripe:setup` in `@secondlayer/api`) upserts one "Secondlayer" product, a Pro monthly price (`$25/mo`, lookup_key `secondlayer_pro_monthly`), and billing meters + metered prices for compute hours, storage GB-months, and AI eval overages. Enterprise remains custom-quoted per deal.
  - Docker `.env.example` documents the new env surface: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_METER_*`, `STRIPE_PRICE_*_OVERAGE`.

- [`a74b01d`](https://github.com/ryanwaits/secondlayer/commit/a74b01d04ad901270a8592beef1a04db2250bb64) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Subscriptions CRUD surface — new `sl.subscriptions.*` client plus the DB schema + query helpers that back it.

  - SDK: `sl.subscriptions.create/list/get/update/delete/rotateSecret/pause/resume` with `CreateSubscriptionResponse` returning a one-time `signingSecret`.
  - Shared: Migration `0057_subscriptions` creates `subscriptions` + `subscription_outbox` + `subscription_deliveries` with the `subscriptions:new_outbox` notify trigger. Kysely types for all three tables. New `standard-webhooks` signing helper (matches Svix reference vectors). Subscription queries with encrypted signing secrets (reuses `crypto/secrets`).
  - OSS bootstrap: `SECONDLAYER_SECRETS_KEY` autogenerates to `.env.local` on first use when `INSTANCE_MODE=oss`.

  No delivery yet — the emitter worker + outbox draining lands Sprint 3. Platform-mode mirror table deferred to a follow-up.

### Patch Changes

- [`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Drop the marketplace-era columns from `subgraphs` (`is_public`, `tags`, `description`, `forked_from_id`) via migration `0045`. The columns were added by `0022_marketplace` and have been unused since the marketplace feature was removed in 2.1.0. Types updated accordingly.

- [`e7d93b3`](https://github.com/ryanwaits/secondlayer/commit/e7d93b3e054cd9e2656dfa1202c90b08ac5e7fa8) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Subscription emitter lands — the end-to-end delivery loop.

  - `SubgraphContext.flush()` now returns a `FlushManifest` describing every write. Existing callers ignoring the return value keep working.
  - `emitSubscriptionOutbox()` runs inside the block-processor transaction: matches each write against active subscriptions, inserts outbox rows (bulk `INSERT ... ON CONFLICT DO NOTHING` on `(subscription_id, dedup_key)` for idempotent replays). Bypassed when `SECONDLAYER_EMIT_OUTBOX=false`.
  - `startEmitter()` boots alongside `startSubgraphProcessor`. `LISTEN subscriptions:new_outbox` + `LISTEN subscriptions:changed`, `FOR UPDATE SKIP LOCKED LIMIT 50` batch claim, per-sub in-memory concurrency semaphore (default 4), HTTP dispatch via Standard Webhooks format with AbortSignal timeout, `subscription_deliveries` attempt log truncated to 8KB. Circuit breaker trips at 20 consecutive failures → sub `paused`. Backoff 30s → 2m → 10m → 1h → 6h → 24h → 72h. Retention sweep hourly.
  - Dashboard subscription detail page polls the last 100 deliveries every 5s.
  - Emitter requires session-mode PG connection — pgbouncer transaction mode breaks the persistent LISTEN. Document in migration guide.

- Updated dependencies [[`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`8f2d720`](https://github.com/ryanwaits/secondlayer/commit/8f2d72038c28aca7bd91efb4b0c93f72bac469d3)]:
  - @secondlayer/stacks@1.0.0

## 3.0.0-beta.2

### Patch Changes

- Subscription emitter lands — the end-to-end delivery loop.

  - `SubgraphContext.flush()` now returns a `FlushManifest` describing every write. Existing callers ignoring the return value keep working.
  - `emitSubscriptionOutbox()` runs inside the block-processor transaction: matches each write against active subscriptions, inserts outbox rows (bulk `INSERT ... ON CONFLICT DO NOTHING` on `(subscription_id, dedup_key)` for idempotent replays). Bypassed when `SECONDLAYER_EMIT_OUTBOX=false`.
  - `startEmitter()` boots alongside `startSubgraphProcessor`. `LISTEN subscriptions:new_outbox` + `LISTEN subscriptions:changed`, `FOR UPDATE SKIP LOCKED LIMIT 50` batch claim, per-sub in-memory concurrency semaphore (default 4), HTTP dispatch via Standard Webhooks format with AbortSignal timeout, `subscription_deliveries` attempt log truncated to 8KB. Circuit breaker trips at 20 consecutive failures → sub `paused`. Backoff 30s → 2m → 10m → 1h → 6h → 24h → 72h. Retention sweep hourly.
  - Dashboard subscription detail page polls the last 100 deliveries every 5s.
  - Emitter requires session-mode PG connection — pgbouncer transaction mode breaks the persistent LISTEN. Document in migration guide.

## 3.0.0-beta.1

### Minor Changes

- Subscriptions CRUD surface — new `sl.subscriptions.*` client plus the DB schema + query helpers that back it.

  - SDK: `sl.subscriptions.create/list/get/update/delete/rotateSecret/pause/resume` with `CreateSubscriptionResponse` returning a one-time `signingSecret`.
  - Shared: Migration `0057_subscriptions` creates `subscriptions` + `subscription_outbox` + `subscription_deliveries` with the `subscriptions:new_outbox` notify trigger. Kysely types for all three tables. New `standard-webhooks` signing helper (matches Svix reference vectors). Subscription queries with encrypted signing secrets (reuses `crypto/secrets`).
  - OSS bootstrap: `SECONDLAYER_SECRETS_KEY` autogenerates to `.env.local` on first use when `INSTANCE_MODE=oss`.

  No delivery yet — the emitter worker + outbox draining lands Sprint 3. Platform-mode mirror table deferred to a follow-up.

## 3.0.0-alpha.0

### Major Changes

- Drop workflow + sentry tables, query helpers, and schemas. Migration 0056 demolishes residual tables (`workflow_runs`, `workflow_steps`, `workflow_queue`, `workflow_ai_usage_daily`, `sentries`, `sentry_alerts`, `tx_confirmed_notify`).

### Minor Changes

- [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Pricing foundation (Sprint A) — switch from 14-day trial to activity-based auto-pause, org-level billing prep.

  - Migration 0046 drops `tenants.trial_ends_at` + index, adds `tenants.last_active_at timestamptz NOT NULL DEFAULT now()` with index `(plan, last_active_at) WHERE status = 'active'`
  - Migration 0047 adds nullable `tenant_id` to `usage_daily` (+ best-effort backfill for single-tenant accounts), widens the unique key to `(account_id, tenant_id, date)` so Sprint-C Stripe metering can bill per-tenant
  - `TrialExpiredError` + `TRIAL_EXPIRED` code dropped (dead after trial removal)
  - New `bumpTenantActivity(slug)` + `listIdleHobbyTenants(idleSince)` query helpers
  - CLI drops trial-days-left from `sl instance info` and `sl whoami`, drops `TRIAL_EXPIRED` handlers

- [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Pricing Sprint C.1 — decouple compute from plan for add-ons.

  - Migration 0048 adds `tenant_compute_addons` table. Each row = one add-on bundle (memory/cpu/storage deltas with optional effective window + Stripe subscription_item_id). Effective compute = plan base + SUM(active deltas).
  - New `@secondlayer/shared/db/queries/tenant-compute-addons` module: `listActiveAddonsForTenant`, `computeEffectiveCompute(tenantId, base)`.
  - `@secondlayer/provisioner` breaking changes:
    - `resizeTenant(slug, planId)` → `resizeTenant(slug, { plan, totalCpus, totalMemoryMb, storageLimitMb })`. Plan stays as a label; sizing is explicit.
    - `getTenantStatus(slug, plan)` → `getTenantStatus(slug, plan, storageLimitMb)`. Caller passes the effective storage limit from the tenants row.
    - `rotateTenantKeys` preserves existing container sizing by reading from `docker inspect` instead of recomputing from the plan — so it stays correct for tenants with add-ons.
    - `POST /tenants/:slug/resize` body shape: `{ plan, totalCpus, totalMemoryMb, storageLimitMb }`.
    - `GET /tenants/:slug` now reads `storageLimitMb` query param.
  - New exported `allocForTotals(totalMemoryMb, totalCpus)` from `packages/provisioner/src/plans.ts` — auto-biases to PG-heavy split below 1 GB, default split above.
  - Platform API `POST /api/tenants/me/resize` now composes plan base + active add-ons via `computeEffectiveCompute` before calling the provisioner. `tenants.cpus/memory_mb/storage_limit_mb` cache the effective values for dashboard + billing.
  - Add-on CRUD + Stripe wiring land in Sprint C.2/C.3; this sprint is data-model + plumbing only.

- [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Soft spend caps with 80% threshold alerts — the core anti-surprise-bill differentiator.

  - Migration 0050 adds `account_spend_caps` table (one row per account): monthly + per-line (compute/storage/ai) caps in cents, configurable `alert_threshold_pct` (default 80), `frozen_at`, `alert_sent_at`.
  - New `@secondlayer/shared/db/queries/account-spend-caps` module: `getCaps`, `upsertCaps`, `freezeAccount`, `clearFreeze`, `listFrozenAccountIds`.
  - Worker cron `spend-cap-alert.ts` runs daily: fetches each paid account's upcoming invoice, sends a Resend email at threshold, sets `frozen_at` at 100%. Alert email debounced per billing cycle via `alert_sent_at` comparison to `period_start`.
  - Compute + storage metering crons now read `listFrozenAccountIds` at the top of each tick and skip frozen accounts entirely. Capped accounts keep running but stop accruing billable usage until the next cycle.
  - Stripe `invoice.paid` webhook clears `frozen_at` + `alert_sent_at` on the paying account, unfreezing metering for the new cycle.
  - Session-authed dashboard endpoints `GET /api/billing/caps` + `PATCH /api/billing/caps`. Raising a monthly cap mid-cycle auto-clears an active freeze (user explicitly said "yes, bill more").

- [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Lay Stripe billing foundation on the platform control plane.

  - Migration 0049 adds nullable `accounts.stripe_customer_id` with a partial unique index (ignores NULLs so Hobby users stay out of Stripe entirely — customer records materialize on first upgrade).
  - New `setStripeCustomerId(accountId, id)` query helper + `stripe_customer_id` on the `Account` type.
  - Platform API gains a lazy Stripe SDK singleton (`packages/api/src/lib/stripe.ts`), webhook endpoint (`POST /api/webhooks/stripe`) with raw-body signature verification + audit trail, and session-authed billing routes (`POST /api/billing/upgrade`, `GET /api/billing/portal`) that lazy-create the Stripe customer on first upgrade and return Checkout/Portal URLs.
  - Idempotent setup script (`bun run stripe:setup` in `@secondlayer/api`) upserts one "Secondlayer" product, a Pro monthly price (`$25/mo`, lookup_key `secondlayer_pro_monthly`), and billing meters + metered prices for compute hours, storage GB-months, and AI eval overages. Enterprise remains custom-quoted per deal.
  - Docker `.env.example` documents the new env surface: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_METER_*`, `STRIPE_PRICE_*_OVERAGE`.

### Patch Changes

- [`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Drop the marketplace-era columns from `subgraphs` (`is_public`, `tags`, `description`, `forked_from_id`) via migration `0045`. The columns were added by `0022_marketplace` and have been unused since the marketplace feature was removed in 2.1.0. Types updated accordingly.

- Updated dependencies []:
  - @secondlayer/stacks@1.0.0-alpha.0

## 2.1.0

### Minor Changes

- [`2024259`](https://github.com/ryanwaits/secondlayer/commit/2024259c0a474dcede50fa8d6fb4018877632435) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Production hardening for dedicated hosting.

  - Per-tenant `pg_dump` backups on an hourly + daily retention ladder; systemd units + Storage Box upload.
  - Agent monitors tenant-pg backup freshness, tenant container health (unhealthy + sustained memory pressure).
  - SSH bastion container gives tenants a direct `DATABASE_URL` via `ssh -L`. New endpoints: `GET /api/tenants/me/db-access`, `POST/DELETE /api/tenants/me/db-access/key`. New CLI: `sl instance db`, `sl instance db add-key <path>`, `sl instance db revoke-key`.
  - `tenant_usage_monthly` table records peak/avg/last storage per month for future billing.
  - `provisioning_audit_log` table captures provision/resize/suspend/resume/rotate/teardown/bastion events.
  - Marketplace removed across the monorepo (SDK, shared schemas + queries, API routes, CLI command, dashboard pages + routes). DB migration for the `0022_marketplace` columns intentionally not reverted — profile columns on accounts are kept for general use; `is_public/tags/description/forked_from_id` stay on `subgraphs` as history and can be dropped in a later migration.

## 2.0.0

### Major Changes

- [`26c090c`](https://github.com/ryanwaits/secondlayer/commit/26c090ce6290ddc5cf42ea8b72e87e80c1a3e786) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Cutover to dedicated-only. Shared-tenancy subgraph code + infra removed now that every customer runs on per-tenant `sl-{role}-<slug>` containers.

  - **Breaking (shared)**: migration `0041` drops `subgraphs.api_key_id`. Schema-level uniqueness restored to `UNIQUE (name)` (previously scoped via `(api_key_id, name)` partial indexes). Tenant DBs already had `NULL api_key_id` — safe.
  - **Breaking (api)**: `/api/subgraphs` + `/api/node` stop mounting in `INSTANCE_MODE=platform`. Platform API is a pure control plane: accounts, projects, sessions, tenants, auth, marketplace, admin. Subgraph queries must hit the tenant URL (`https://{slug}.{BASE_DOMAIN}/api/subgraphs`).
  - **Breaking (api)**: `assertSubgraphOwnership` now a thin DB read — every remaining caller already proved tenant-membership via JWT/static-key middleware.
  - `pgSchemaName(name, accountPrefix?)` → `pgSchemaName(name)`. Tenant DBs are self-contained — no prefix disambiguation.
  - Admin stats endpoint returns tenant counts (`totalTenants`, `activeTenants`, `suspendedTenants`) in place of the old subgraph counts.
  - Worker `measureStorage` cron skips in platform mode (per-tenant measurement is the provisioner's job).
  - Infra: `subgraph-processor` service + hetzner volume override removed from compose; `deploy.sh` includes `--profile platform` so provisioner picks up compose changes without manual recreate.

### Minor Changes

- [`ebea60d`](https://github.com/ryanwaits/secondlayer/commit/ebea60da47f6fd12d1052166aa929951f5a0cb2b) Thanks [@ryanwaits](https://github.com/ryanwaits)! - CLI DX rework, Sprint 1 (backend foundation):

  - Migration `0042_tenant_project_id` — adds `tenants.project_id uuid REFERENCES projects(id) ON DELETE SET NULL` + index. Supports `1 project : 1 tenant` today, `1 project : N tenants` later.
  - `TenantsTable.project_id` added to types. `insertTenant` accepts optional `projectId`.
  - No migration of existing tenant rows — `project_id = NULL` is legal (legacy tenants provisioned via `POST /api/tenants`). New provisions via `POST /api/projects/:slug/instance` populate it.

- [`7567649`](https://github.com/ryanwaits/secondlayer/commit/756764942865fbcc6d98608861abfbda2e175a86) Thanks [@ryanwaits](https://github.com/ryanwaits)! - CLI v2 — session-based auth, tenant auto-resolve, full instance lifecycle.

  **Breaking changes (`@secondlayer/cli`)**:

  - `sl auth login/logout/status` replaced by top-level `sl login` / `sl logout`. `sl auth` command group removed entirely.
  - `sl auth keys list/create/revoke/rotate` removed. Session tokens are the only CLI credential; machine access uses `SL_SERVICE_KEY`.
  - `sl instance connect <url> --key` removed. Tenant URL + service key are auto-resolved per command from the session.
  - `sl sync` removed (superseded by `sl local`).
  - `~/.secondlayer/config.json` no longer holds `apiUrl` / `apiKey`. Sessions at `~/.secondlayer/session.json`.
  - `SECONDLAYER_API_KEY` env var no longer read.

  **New (`@secondlayer/cli`)**:

  - `sl login` — magic-link email with 6-digit code. Session cached 90d with server-side sliding-window renewal.
  - `sl logout` — revokes session server-side + clears local file.
  - `sl whoami` — shows email, plan, active project, instance URL + trial days.
  - `sl project create <name> | list | use <slug> | current` — project management, per-directory binding at `./.secondlayer/project`.
  - `sl instance create --plan <…> | info | resize | suspend | resume | delete | keys rotate` — full tenant lifecycle.
  - Resolver auto-mints 5-min ephemeral service JWTs per command. No long-lived service key on disk.
  - `SL_SERVICE_KEY` + `SL_API_URL` env-var bypass for CI/OSS. `sl instance *` refuses in OSS mode with a clear error.

  **`@secondlayer/shared`**:

  - New error codes + classes: `KeyRotatedError` (401), `TrialExpiredError` (402), `TenantSuspendedError` (423). `NO_TENANT_FOR_PROJECT` (404) and `INSTANCE_EXISTS` (409) added to `CODE_TO_STATUS`.
  - Tenant API `auth-modes.dedicatedAuth` throws `KeyRotatedError` on gen mismatch so the CLI can retry-once transparently.

- [`2605a4f`](https://github.com/ryanwaits/secondlayer/commit/2605a4fb3b558c942cddef2955709088f1c67450) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Phase 1 instance-page hardening. Adds per-tenant key rotation with independent service/anon generations, suspend/resume endpoints on the provisioner, hard-delete teardown, typed provisioner errors, and automatic attachment of the platform postgres to `sl-source` with a `postgres` alias at provision time.

  - `jwt.ts` — `mintTenantKeys` now takes `{ serviceGen, anonGen }` and embeds a `gen` claim; adds `mintSingleKey` for role-scoped rotation.
  - `lifecycle.ts` — new `rotateTenantKeys(slug, plan, type, newGens)` recreates the tenant API container with new env vars and mints replacement key(s).
  - `routes.ts` — adds `POST /tenants/:slug/keys/rotate`; bubbles typed error codes + appropriate HTTP status via new `httpStatusForProvisionError`.
  - `types.ts` — adds `ProvisionErrorCode`, `classifyProvisionError`, `httpStatusForProvisionError`.
  - `docker.ts` — adds `networkConnectWithAlias` (idempotent); `provision.ts` calls it to attach `secondlayer-postgres-1` to `sl-source` as `postgres` so fresh Hetzner hosts work without manual compose edits.
  - `@secondlayer/shared` — migration `0040_tenant_key_generations` adds `service_gen` + `anon_gen` counters to `tenants`; new queries `bumpTenantKeyGen`, `updateTenantKeys`, `deleteTenant`.
  - `@secondlayer/api` middleware — `dedicatedAuth` validates the `gen` claim against `SERVICE_GEN`/`ANON_GEN` env; adds `/me/keys/rotate`, `/me/suspend`, `/me/resume`; changes `DELETE /me` from soft-suspend to hard-delete (containers + volume + DB row).

### Patch Changes

- [`416f7c4`](https://github.com/ryanwaits/secondlayer/commit/416f7c4a53bcc7c96362f23c19e9b715622819d7) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Fix `getOrCreatePool` TLS-skip heuristic: any dotless hostname (Docker service alias like `postgres`, `sl-pg-<slug>`) is now treated as local and skips TLS. Previously only `@postgres:` was whitelisted, causing tenant-DB connections to `sl-pg-<slug>` to try TLS against a non-TLS alpine postgres → ECONNRESET.

## 1.1.0

### Minor Changes

- [`4f1c7ea`](https://github.com/ryanwaits/secondlayer/commit/4f1c7eaa9242295972404174b24049c54d6b7a50) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Workflows v2 — Sprint 1: AI SDK v6 substrate + sub-step memoization.

  **New step primitives:**

  - `step.generateObject(id, { model, schema, prompt, system? })` — Zod-schemaed structured output via AI SDK v6, any provider
  - `step.generateText(id, { model, prompt, tools?, maxSteps? })` — tool-calling agent loop; tools declared via AI SDK `tool()`

  **Sub-step tool memoization:** tool calls inside `generateText`/`generateObject` persist as child `workflow_steps` rows (new `parent_step_id` column). On parent retry, previously successful tool calls serve from cache instead of re-invoking `execute`.

  **Hash-based memo key:** new `workflow_steps.memo_key` column keys memoization by `sha256(stepId + canonicalJSON(stableInputs))`. Editing a prompt or schema in source invalidates the cache on the next run. **Breaking behavior change** vs v1's `(run_id, step_id)` tuple lookup.

  **`step.ai` deprecated (90-day sunset):** now a shim over `generateObject` that converts the `SchemaField` DSL to Zod. Existing v1 templates continue to work unchanged; migrate at leisure.

  **`tool` re-exported** from `@secondlayer/workflows` — authors write `import { tool } from "@secondlayer/workflows"` + `step.generateText({ tools })`.

  **Bundler:**

  - Raise workflow bundle cap 1 MB → 4 MB (matches subgraph cap)
  - Replace data-URI import with tmpfile import to avoid `NameTooLong` on bundles that include AI SDK dependencies

  **Shared:**

  - New `@secondlayer/shared/pricing` — provider × model USD/M-token constants for dashboard observability

  **Migration required:** `0033_workflow_steps_memo_key` — adds `memo_key` + `parent_step_id` columns to `workflow_steps`, swaps legacy `(run_id, step_id)` UNIQUE index for partial `(run_id, memo_key)` UNIQUE. Runner requires this migration before restart.

- [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Workflows v2 — Sprint 4: chain writes via customer-owned Remote Signer.

  Workflows can now broadcast Stacks transactions without Secondlayer holding any private key. The runner POSTs unsigned tx + context to a customer-hosted HTTPS endpoint, the customer signs, the runner submits.

  **`@secondlayer/workflows`:**

  - New `signers: Record<string, SignerConfig>` field on `WorkflowDefinition`
  - New `signer.remote({ endpoint, publicKey, hmacRef, timeoutMs? })` factory — `hmacRef` names a secret stored separately (see `sl secrets`) so rotation doesn't require redeploy

  **`@secondlayer/stacks`:**

  - New `broadcast(intent, { signer, maxMicroStx?, maxFee?, awaitConfirmation? })` — submits a `TxIntent` via the workflow-declared signer. Returns `{ txId, confirmed }` (confirmation polling lands Sprint 5)
  - New `broadcastContext` AsyncLocalStorage — runner scopes the `BroadcastRuntime` per run; concurrent runs don't share state
  - New error taxonomy: `TxRejectedError` (reason union + `isRetryable`), `TxTimeoutError`, `TxSignerRefusedError`

  **`@secondlayer/shared`:**

  - New `@secondlayer/shared/crypto/secrets` — AES-256-GCM envelope (`encryptSecret` / `decryptSecret` / `generateSecretsKey`). Key from `SECONDLAYER_SECRETS_KEY` env
  - New `workflow_signer_secrets` table via migration `0034`

  **`@secondlayer/bundler`:**

  - Deploy-time lint: flags `broadcast()` calls lexically inside a `tool({...})` body that lack `maxMicroStx` + `maxFee` OR `postConditions`. Escape hatch: `// @sl-unsafe-broadcast` comment on the broadcast line. Protects against AI-drainable toolsets.

  **`@secondlayer/cli`:**

  - New `sl secrets list|set|rotate|delete` commands. `set` and `rotate` prompt for the value via masked input if not supplied on the command line

  **New package `@secondlayer/signer-node`:**

  - Customer-hosted reference signer service. `createSignerService({ privateKeyHex, hmacSecret, policy })` returns a Hono app; mount on any Fetch-compatible runtime (Bun, Deno, Cloudflare Workers, Node via `@hono/node-server`)
  - Policy helpers: `allowlistFunctions`, `dailyCapMicroStx`, `requireApproval`, `composePolicies`, `denyAll`
  - Railway example under `packages/signer-node/examples/railway/`

  **API:**

  - New `/api/secrets` routes — list / upsert / delete per-account. Values AES-encrypted at rest; never returned to clients.

  **Migrations required:** `0034_workflow_signer_secrets` before runner restart.

  **Runtime env added:** `SECONDLAYER_SECRETS_KEY` (32-byte hex, generate with `openssl rand -hex 32`). API + runner both need it to en/decrypt. Without it, `sl secrets set` and broadcast both error at call-site.

  **Sprint 4 scope limits (expand later):**

  - `broadcast` supports `TransferIntent` + `ContractCallIntent` only; `DeployIntent` + `MultiSendIntent` throw "not yet implemented"
  - `awaitConfirmation: true` is a no-op in Sprint 4; Sprint 5 wires subgraph pg_notify confirmation polling
  - Default fee: 10k µSTX when `maxFee` isn't supplied. No fee estimation yet — Sprint 5 will add estimateFee-driven defaults.

- [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Workflows v2 — Sprint 5: budgets, awaitConfirmation, error-aware retries.

  **`@secondlayer/workflows`:**

  - New `WorkflowDefinition.budget: BudgetConfig` field with caps across three dimensions:
    - `ai`: `maxUsd`, `maxTokens`
    - `chain`: `maxMicroStx`, `maxTxCount`
    - `run`: `maxDurationMs`, `maxSteps`
  - `reset`: `"daily" | "weekly" | "per-run"` — period boundary
  - `onExceed`: `"pause" | "alert" | "silent"` — pause the workflow (default), fire a `onExceedTarget` delivery, or tick counters silently
  - Zod validation on deploy

  **`@secondlayer/shared`:**

  - New migration `0035_workflow_budgets` — `workflow_budgets` table with one row per `(workflow_definition_id, period)`. Tracks `ai_usd_used`, `ai_tokens_used`, `chain_microstx_used`, `chain_tx_count`, `run_count`, `step_count`, `reset_at`
  - New migration `0036_tx_confirmed_notify` — pg_notify trigger on core `transactions` table publishing tx_id on `tx:confirmed` channel

  **`@secondlayer/workflow-runner`:**

  - `budget/enforcer.ts` — per-run `BudgetEnforcer` called from `memoize()`. `assertBeforeStep()` refuses if any counter is exhausted; `recordAi` / `recordBroadcast` / `recordStep` increment after each step. Emits `BudgetExceededError` (non-retryable) on `pause` behavior
  - `budget/reset-cron.ts` — runs every minute. Auto-resumes `status = "paused:budget"` workflows once their period rolls over; prunes budget rows older than 30 days (excluding `per-run` rows)
  - `confirmation/subgraph.ts` — pg_notify listener on `tx:confirmed`. `awaitTxConfirmed(txId, timeoutMs)` returns when the indexer inserts a matching row; times out with `TxTimeoutError` (retryable with fee bump). **No Hiro fallback** — Secondlayer's native indexer is the source of truth.
  - `broadcast` runtime now honors `awaitConfirmation: true` — blocks until confirmed or times out. Default timeout: 120 seconds.
  - `queue.ts` retry policy consults the thrown error's `isRetryable` property. `TxRejectedError[abort_by_post_condition]`, `TxSignerRefusedError`, `BudgetExceededError` all mark as non-retryable and skip the exponential backoff loop, failing the run immediately with the classification reason appended to the error message.

  **Breaking change:** runners must apply migrations `0035` + `0036` before restart. Workflows deployed before Sprint 5 continue to work without budgets (the `budget` field is optional).

  **Deferred:**

  - Dashboard burn-down UI for budgets (follows up with a Sprint 5.5 patch; the underlying counters are already being tracked)
  - Fee estimation (`maxFee` default stays 10k µSTX — Sprint 6 will drive defaults off `estimateFee`)

### Patch Changes

- Updated dependencies [[`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955), [`7e1cf3d`](https://github.com/ryanwaits/secondlayer/commit/7e1cf3d4048b310c036ae30dac0d76f06d712375), [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1), [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3), [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01), [`696124e`](https://github.com/ryanwaits/secondlayer/commit/696124e115dc64d88eede394bbf422eb9a514849)]:
  - @secondlayer/stacks@0.3.0

## 1.0.0

### Major Changes

- [#13](https://github.com/ryanwaits/secondlayer/pull/13) [`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Remove the streams product feature (real-time webhook deliveries) across the entire stack. Streams have been deprecated in favor of workflows + subgraphs.

  **Breaking changes:**

  - **SDK**: `client.streams.*` removed. `@secondlayer/sdk/streams` subpath export removed. `WorkflowSummary.triggerType` no longer accepts `"stream"`.
  - **CLI**: `sl streams *` commands removed (new, register, ls, get, set, logs, replay, rotate-secret, delete). `sl receiver`, `sl setup` commands removed. `sl status` / `sl doctor` no longer show stream/queue sections. `--wait` stop flags no longer drain a job queue.
  - **MCP**: `streams_*` tools removed. `workflows_scaffold` no longer accepts `type: "stream"` triggers. Stream filter MCP resource renamed to "event filter".
  - **API**: `/api/streams*` routes removed. `/api/logs/:id/stream` SSE endpoint removed. `/api/admin/stats` no longer returns `totalStreams`. `/api/accounts/usage` no longer returns `current.streams`. `/api/status` no longer returns queue/stream counts.
  - **Shared**: `StreamsTable`, `StreamMetricsTable`, `JobsTable`, `DeliveriesTable` dropped from `Database` interface. `@secondlayer/shared/queue` and `@secondlayer/shared/queue/recovery` subpaths removed. `@secondlayer/shared/db/queries/metrics` removed. `StreamNotFoundError` renamed to `NotFoundError`. `StreamsError` base class renamed to `SecondLayerError`. Dead subclasses `DeliveryError` and `FilterEvaluationError` removed. `StreamFilter` / `StreamFilterSchema` renamed to `EventFilter` / `EventFilterSchema`. `incrementDeliveries` removed (dead — no callers). `PlanLimits.streams` removed from `FREE_PLAN`.
  - **Worker**: stream processor, delivery dispatcher, signing, tracking, rate-limiter, and matcher all removed. Worker now runs only the scheduled storage-measurement job.
  - **Scaffold**: `generateStreamConfig` removed. Workflow trigger type no longer accepts `"stream"`.
  - **Workflows**: `StreamTrigger` type removed from `WorkflowTrigger` union.
  - **Workflow runner**: only `event` and `schedule` triggers are matched now.
  - **DB migration #32**: drops `streams`, `stream_metrics`, `jobs`, and `deliveries` tables. Renames PG NOTIFY channel from `streams:new_job` to `indexer:new_block`.

  **Bug fixes:**

  - CLI receiver was reading the wrong signature header (`x-streams-signature`) while the worker ships `X-Secondlayer-Signature`. The entire receiver is now removed.
  - Workflow scaffold paths (SDK + MCP + sessions) were emitting `type: "stream"` triggers that no longer typecheck against the workflows package.

### Patch Changes

- [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Server-side subgraph bundler + source capture, mirroring the workflows authoring loop.

  - **API**: new `POST /api/subgraphs/bundle` runs `bundleSubgraphCode` from `@secondlayer/bundler` and returns `{ name, version, sources, schema, handlerCode, sourceCode, bundleSize }`. `BundleSizeError → 413`, other failures → 400 with `code: "BUNDLE_FAILED"`. New `GET /api/subgraphs/:name/source` returns the original TypeScript source for deployed subgraphs, or a `readOnly` payload for rows predating the migration. `POST /api/subgraphs` now threads `sourceCode` through `deploySchema` so the original source is persisted on deploy.
  - **SDK**: new `subgraphs.bundle({ code })` and `subgraphs.getSource(name)` methods + `BundleSubgraphResponse` / `SubgraphSource` types.
  - **shared**: migration `0031_subgraph_source_code` adds `source_code TEXT NULL` to the `subgraphs` table; `registerSubgraph` upsert + `DeploySubgraphRequest` schema both accept an optional `sourceCode` field (max 1MB).
  - **subgraphs**: `deploySchema()` accepts `sourceCode` in its options and forwards it to `registerSubgraph`.

  Unlocks the next wave of the chat authoring loop (read/edit/deploy/tail subgraphs in a session).

- [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - Introduce `@secondlayer/bundler`: shared esbuild + validate helpers (`bundleSubgraphCode`, `bundleWorkflowCode`) with typed `BundleSizeError` and per-kind caps (subgraphs 4 MB, workflows 1 MB). MCP and CLI now consume it instead of inlining esbuild.

  - Persist workflow TypeScript source alongside the compiled handler (`workflow_definitions.source_code`, migration `0030`). `upsertWorkflowDefinition` bumps the patch version on every update and throws `VersionConflictError` when `expectedVersion` does not match the stored row.
  - Extend `DeployWorkflowRequestSchema` and the SDK/CLI deploy path with `sourceCode` + `expectedVersion`, so `sl workflows deploy` populates the new column and surfaces conflict detection.

- [`38e62e7`](https://github.com/ryanwaits/secondlayer/commit/38e62e74e600c353884fc89a5e22b8840a4d2689) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - `POST /api/workflows` now maps `VersionConflictError` to HTTP 409 `{ error, code, currentVersion, expectedVersion }`, reads `x-sl-origin: cli|mcp|session` for telemetry, and logs every deploy. The response body now includes the resolved `version`.

  - Added `dryRun: true` mode on `POST /api/workflows` — validates the bundle via data-URI import, skips disk and DB writes, and returns `{ valid, validation, bundleSize }`.
  - Added `GET /api/workflows/:name/source` — returns `{ name, version, sourceCode, readOnly, updatedAt }`, with a `readOnly: true` degradation for workflows deployed before source capture.
  - SDK: `Workflows.deploy()` accepts `expectedVersion` and `dryRun` and throws a typed `VersionConflictError` on 409. `Workflows.getSource(name)` fetches the stored source. Every SDK request sends `x-sl-origin` (default `cli`, overridable via `new SecondLayer({ origin })`). `ApiError` now preserves the parsed response body.
  - MCP: new `workflows_deploy` tool (bundles via `@secondlayer/bundler`, sets `x-sl-origin: mcp`, surfaces bundler errors verbatim, supports `expectedVersion` + `dryRun`), `workflows_get_definition` (returns stored TypeScript source), and `workflows_delete`.

- [`e9c298c`](https://github.com/ryanwaits/secondlayer/commit/e9c298c828770e8ff538b957a7d7f38a7753900f) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Ship-ready workflow polish: versioning, rollback, bulk ops, and idempotent deploys.

  - **Versioned handler bundles.** `POST /api/workflows` now writes `data/workflows/{name}-{version}.js` (exported `bumpPatch` from `@secondlayer/shared`). The runner already reads `handler_path` from the row so in-flight runs finish on their original bundle while new runs pick up the latest. The route opportunistically prunes on-disk bundles to the most recent 3 versions after every deploy.
  - **Rollback.** New `POST /api/workflows/:name/rollback` route picks a prior on-disk bundle (or the specified `toVersion`), re-publishes it as a new patch version for audit, and refreshes `handler_path`. SDK `workflows.rollback()`, MCP `workflows_rollback`, and a web `rollback_workflow` HIL session tool (re-using the existing action card) are all wired up.
  - **Bulk pause + cancel run.** `POST /api/workflows/pause-all` pauses every active workflow in the account (and disables their `workflow_schedules` rows). `POST /api/workflows/runs/:runId/cancel` marks a running / pending run as cancelled and removes any queue entry. Exposed via `workflows.pauseAll()` / `workflows.cancelRun()` and new `workflows_pause_all` / `workflows_cancel_run` MCP tools.
  - **Idempotent deploy.** `DeployWorkflowRequestSchema` gained a `clientRequestId` field. The API keeps a 30-second in-memory cache keyed by `(apiKeyId, clientRequestId)` and replays the previous response on a repeat POST. The chat deploy card sends `deploy-${toolCallId}`, and the edit card sends `edit-${expectedVersion}-${name}` so double-clicks and accidental re-confirms don't double-deploy.
  - **Workflow detail → chat.** The `/workflows/[name]` page now has an **Open in chat** CTA that navigates to a fresh session pre-seeded with `Read the workflow "{name}" and show me its source so I can edit it.`

## 0.12.3

### Patch Changes

- Add waitlist query functions (listWaitlist, getWaitlistById, approveWaitlistEntry) and admin constants export

## 0.12.2

### Patch Changes

- fix schema diff false positives from JSONB key reordering; hot-reload handler code after redeploy; handle bigint in jsonb serialization

## 0.12.1

### Patch Changes

- fix(subgraphs): complete accountId migration across deployer, marketplace, ownership

  Removes remaining apiKeyId fallbacks introduced in the Sprint 1 account-scoping change:

  - deployer.ts: getSubgraph lookup no longer falls back to apiKeyId
  - marketplace.ts: fork collision check and schema prefix use accountId
  - ownership.ts: assertSubgraphOwnership checks account_id instead of api_key_id
  - deleteSubgraph: uses accountId parameter consistently

## 0.12.0

### Minor Changes

- feat(subgraphs): smart deploy — auto-versioning, auto-reindex, schema diff

  - System now owns versioning: patch auto-increments on every deploy (1.0.0 → 1.0.1); use --version flag for intentional bumps
  - Breaking schema changes auto-trigger reindex — no --reindex flag needed
  - Deploy output shows schema diff (added tables/columns, breaking changes, new version)
  - version field removed from schema hash so version bumps don't look like schema changes
  - --force flag skips reindex confirmation prompt
  - Handler code persisted in DB so container restarts don't break in-flight reindexes (migration 0029)

## 0.11.0

### Minor Changes

- feat(subgraphs): account-wide subgraph scoping

  Subgraphs are now scoped at the account level rather than per API key. Any API key on the same account can deploy and update the same named subgraph without creating duplicates. Includes migration 0028 which adds `account_id` to the subgraphs table and renames existing PG schemas to use account prefix instead of key prefix.

  **Breaking for self-hosted:** Run migration 0028 before deploying. Stop the subgraph processor before running the migration (it renames live PG schemas).

## 0.10.1

### Patch Changes

- 885662d: feat(subgraphs): named-object sources with SubgraphFilter discriminated union

  Breaking: sources changed from `SubgraphSource[]` to `Record<string, SubgraphFilter>`. Handler keys are now source names, not derived sourceKey strings. Event data auto-unwrapped via cvToValue. New context methods: patch, patchOrInsert, formatUnits, aggregates.

## 0.10.0

### Minor Changes

- Deploy-resilient reindexing: abort support, auto-resume on startup, graceful shutdown, and `sl subgraphs stop` command.

## 0.9.0

### Minor Changes

- Add 6-digit login code alongside magic link for dual auth (code entry + link click).

## 0.8.1

### Patch Changes

- e274333: fix(subgraphs): use highest_seen_block ceiling and add startBlock support

## 0.8.0

### Minor Changes

- [`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Add subgraph gap detection, tracking, and backfill across runtime, API, SDK, and CLI

## 0.7.1

### Patch Changes

- Batch block fetching with adaptive sizing and prefetch pipeline for 15-18x faster subgraph catch-up. Batch INSERT statements on flush. Non-destructive backfill support. Increase default DB connection pool to 20.

## 0.7.0

### Minor Changes

- Cache Hiro event archive locally for up to 24h to avoid redundant ~25GB downloads during auto-backfill.

## 0.6.1

### Patch Changes

- Add ArchiveReplayClient for backfilling from Hiro event observer archive, removing public API dependency

## 0.6.0

### Minor Changes

- Add HiroPgClient for direct-PG bulk backfill, increase default fetch timeout to 120s.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.2.2

## 0.5.1

### Patch Changes

- Migrate all zod imports from v3 compat layer to zod/v4 and fix type errors.

## 0.5.0

### Minor Changes

- 4b716bd: Rename "views" product to "subgraphs" across entire codebase. Package `@secondlayer/views` is deprecated in favor of `@secondlayer/subgraphs`. All types, functions, API routes, CLI commands, and DB tables renamed accordingly.

## 0.4.0

### Minor Changes

- Add contract query helpers with full-text search via pg_trgm. Add `getContractAbi()` for Stacks node RPC. Add `ForbiddenError` class. Treat Hiro 429 responses as reachable and increase health check timeout. Drop contracts table in favor of views system.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.2.0

## 0.3.0

### Minor Changes

- 48e42ba: Add local replay client for self-serve block reconstruction from Postgres. Add tx_index migration and type. Export local-client from package.

### Patch Changes

- Updated dependencies [a070de2]
  - @secondlayer/stacks@0.1.0

## 0.2.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.4

## 0.2.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.3

## 0.2.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.2

## 0.2.0

### Minor Changes

- Add @secondlayer/shared package with DB layer, job queue, schemas, HMAC signing, and Stacks node clients
