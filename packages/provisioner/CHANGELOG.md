# @secondlayer/provisioner

## 0.4.0-alpha.0

### Minor Changes

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

### Patch Changes

- [`bb380bc`](https://github.com/ryanwaits/secondlayer/commit/bb380bc23c4e2a5fd514108f21f1cceb3178a610) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Auto-resume paused Hobby tenants on direct-API traffic.

  - New `POST /internal/resume/:slug` on the provisioner. Kicks off an async `resumeTenant` for suspended containers and returns `503 Retry-After: 30` so the caller retries after the containers are healthy (~20s). Already-running containers short-circuit to 503 too — next retry lands on the upstream. Unknown slugs → 404. No auth; same internal-network gating as `/internal/caddy/ask`.
  - Caddyfile gains a `handle_errors` block on the wildcard tenant route that proxies upstream dial failures (502/503/504) to the resume endpoint. Idempotent; duplicate resume calls cost nothing. Completes the Hobby resume story: dashboard had a button, CLI had mint-ephemeral transparent resume, direct-API callers now auto-resume too.

- Updated dependencies [[`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11), [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c), [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4), [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8), [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2)]:
  - @secondlayer/shared@3.0.0-alpha.0

## 0.3.0

### Minor Changes

- [`2024259`](https://github.com/ryanwaits/secondlayer/commit/2024259c0a474dcede50fa8d6fb4018877632435) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Production hardening for dedicated hosting.

  - Per-tenant `pg_dump` backups on an hourly + daily retention ladder; systemd units + Storage Box upload.
  - Agent monitors tenant-pg backup freshness, tenant container health (unhealthy + sustained memory pressure).
  - SSH bastion container gives tenants a direct `DATABASE_URL` via `ssh -L`. New endpoints: `GET /api/tenants/me/db-access`, `POST/DELETE /api/tenants/me/db-access/key`. New CLI: `sl instance db`, `sl instance db add-key <path>`, `sl instance db revoke-key`.
  - `tenant_usage_monthly` table records peak/avg/last storage per month for future billing.
  - `provisioning_audit_log` table captures provision/resize/suspend/resume/rotate/teardown/bastion events.
  - Marketplace removed across the monorepo (SDK, shared schemas + queries, API routes, CLI command, dashboard pages + routes). DB migration for the `0022_marketplace` columns intentionally not reverted — profile columns on accounts are kept for general use; `is_public/tags/description/forked_from_id` stay on `subgraphs` as history and can be dropped in a later migration.

### Patch Changes

- Updated dependencies [[`2024259`](https://github.com/ryanwaits/secondlayer/commit/2024259c0a474dcede50fa8d6fb4018877632435)]:
  - @secondlayer/shared@2.1.0

## 0.2.0

### Minor Changes

- [`26c090c`](https://github.com/ryanwaits/secondlayer/commit/26c090ce6290ddc5cf42ea8b72e87e80c1a3e786) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Cutover to dedicated-only. Shared-tenancy subgraph code + infra removed now that every customer runs on per-tenant `sl-{role}-<slug>` containers.

  - **Breaking (shared)**: migration `0041` drops `subgraphs.api_key_id`. Schema-level uniqueness restored to `UNIQUE (name)` (previously scoped via `(api_key_id, name)` partial indexes). Tenant DBs already had `NULL api_key_id` — safe.
  - **Breaking (api)**: `/api/subgraphs` + `/api/node` stop mounting in `INSTANCE_MODE=platform`. Platform API is a pure control plane: accounts, projects, sessions, tenants, auth, marketplace, admin. Subgraph queries must hit the tenant URL (`https://{slug}.{BASE_DOMAIN}/api/subgraphs`).
  - **Breaking (api)**: `assertSubgraphOwnership` now a thin DB read — every remaining caller already proved tenant-membership via JWT/static-key middleware.
  - `pgSchemaName(name, accountPrefix?)` → `pgSchemaName(name)`. Tenant DBs are self-contained — no prefix disambiguation.
  - Admin stats endpoint returns tenant counts (`totalTenants`, `activeTenants`, `suspendedTenants`) in place of the old subgraph counts.
  - Worker `measureStorage` cron skips in platform mode (per-tenant measurement is the provisioner's job).
  - Infra: `subgraph-processor` service + hetzner volume override removed from compose; `deploy.sh` includes `--profile platform` so provisioner picks up compose changes without manual recreate.

- [`2605a4f`](https://github.com/ryanwaits/secondlayer/commit/2605a4fb3b558c942cddef2955709088f1c67450) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Phase 1 instance-page hardening. Adds per-tenant key rotation with independent service/anon generations, suspend/resume endpoints on the provisioner, hard-delete teardown, typed provisioner errors, and automatic attachment of the platform postgres to `sl-source` with a `postgres` alias at provision time.

  - `jwt.ts` — `mintTenantKeys` now takes `{ serviceGen, anonGen }` and embeds a `gen` claim; adds `mintSingleKey` for role-scoped rotation.
  - `lifecycle.ts` — new `rotateTenantKeys(slug, plan, type, newGens)` recreates the tenant API container with new env vars and mints replacement key(s).
  - `routes.ts` — adds `POST /tenants/:slug/keys/rotate`; bubbles typed error codes + appropriate HTTP status via new `httpStatusForProvisionError`.
  - `types.ts` — adds `ProvisionErrorCode`, `classifyProvisionError`, `httpStatusForProvisionError`.
  - `docker.ts` — adds `networkConnectWithAlias` (idempotent); `provision.ts` calls it to attach `secondlayer-postgres-1` to `sl-source` as `postgres` so fresh Hetzner hosts work without manual compose edits.
  - `@secondlayer/shared` — migration `0040_tenant_key_generations` adds `service_gen` + `anon_gen` counters to `tenants`; new queries `bumpTenantKeyGen`, `updateTenantKeys`, `deleteTenant`.
  - `@secondlayer/api` middleware — `dedicatedAuth` validates the `gen` claim against `SERVICE_GEN`/`ANON_GEN` env; adds `/me/keys/rotate`, `/me/suspend`, `/me/resume`; changes `DELETE /me` from soft-suspend to hard-delete (containers + volume + DB row).

### Patch Changes

- [`8ab37e8`](https://github.com/ryanwaits/secondlayer/commit/8ab37e87acd41d772b0536a2243700789888abee) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Pivot tenant public routing from Traefik to Caddy wildcard + on-demand TLS. Provisioner drops the `traefik.*` container labels (dead code after pivot) and adds an unauth `GET /internal/caddy/ask?domain=<host>` endpoint — called in-cluster by Caddy before issuing a Let's Encrypt cert for `{slug}.{base}`. Returns 200 iff `sl-api-{slug}` exists.

- Updated dependencies [[`ebea60d`](https://github.com/ryanwaits/secondlayer/commit/ebea60da47f6fd12d1052166aa929951f5a0cb2b), [`7567649`](https://github.com/ryanwaits/secondlayer/commit/756764942865fbcc6d98608861abfbda2e175a86), [`26c090c`](https://github.com/ryanwaits/secondlayer/commit/26c090ce6290ddc5cf42ea8b72e87e80c1a3e786), [`416f7c4`](https://github.com/ryanwaits/secondlayer/commit/416f7c4a53bcc7c96362f23c19e9b715622819d7), [`2605a4f`](https://github.com/ryanwaits/secondlayer/commit/2605a4fb3b558c942cddef2955709088f1c67450)]:
  - @secondlayer/shared@2.0.0
