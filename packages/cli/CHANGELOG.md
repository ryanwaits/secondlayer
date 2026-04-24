# @secondlayer/cli

## 3.3.0

### Minor Changes

- Add the agent-native subscription golden path: shared subscription schemas, schema-aware API and CLI validation, first-class `sl subscriptions` lifecycle commands, MCP lifecycle parity, and updated subscription docs.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@4.1.0
  - @secondlayer/sdk@3.1.0

## 3.2.1

### Patch Changes

- Subscription template prose cleanup (Cloudflare Workflows disambiguation, Inngest claim tightened); `resolve-tenant` doc updated for subscriptions surface.

- Updated dependencies []:
  - @secondlayer/sdk@3.0.1
  - @secondlayer/shared@4.0.0
  - @secondlayer/stacks@1.0.1
  - @secondlayer/subgraphs@1.1.0

## 3.2.0

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

- [`d16a3dd`](https://github.com/ryanwaits/secondlayer/commit/d16a3dd64e12d9c683ca4c5dcbb2c44837bdd5c6) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Multi-format dispatch + `sl create subscription` scaffolder.

  - `@secondlayer/subgraphs`: 5 new format builders — Inngest events API, Trigger.dev v3 task trigger, Cloudflare Workflows, CloudEvents 1.0 structured JSON, and raw. The emitter dispatches on `subscription.format`; unknown values fall back to `standard-webhooks` with a warning log.
  - `@secondlayer/cli`: `sl create subscription <name> --runtime <inngest|trigger|cloudflare|node>` scaffolds a runtime-specific receiver project (package.json + src + README + tsconfig), then provisions the subscription via the SDK and writes the one-time signing secret into `.env`. Templates live at `packages/cli/templates/subscriptions/<runtime>/` and ship in the npm tarball.

### Patch Changes

- [`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Extend the README with a full `sl generate` section covering code generation against local `.clar` files, deployed contracts, and the plugin system (`clarinet`, `actions`, `react`, `testing`). Remove unused `secrets.ts` + `workflows.ts` command stubs that were never registered.

- [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Pricing foundation (Sprint A) — switch from 14-day trial to activity-based auto-pause, org-level billing prep.

  - Migration 0046 drops `tenants.trial_ends_at` + index, adds `tenants.last_active_at timestamptz NOT NULL DEFAULT now()` with index `(plan, last_active_at) WHERE status = 'active'`
  - Migration 0047 adds nullable `tenant_id` to `usage_daily` (+ best-effort backfill for single-tenant accounts), widens the unique key to `(account_id, tenant_id, date)` so Sprint-C Stripe metering can bill per-tenant
  - `TrialExpiredError` + `TRIAL_EXPIRED` code dropped (dead after trial removal)
  - New `bumpTenantActivity(slug)` + `listIdleHobbyTenants(idleSince)` query helpers
  - CLI drops trial-days-left from `sl instance info` and `sl whoami`, drops `TRIAL_EXPIRED` handlers

- [`9f7e3e6`](https://github.com/ryanwaits/secondlayer/commit/9f7e3e6299720c8883b03bbde55bd763d93d576c) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Pricing Sprint B — introduce the Hobby (free) plan + Nano compute.

  - New `hobby` PlanId in the provisioner + API routes + CLI. Nano spec: 0.5 vCPU / 512 MB RAM / 5 GB storage.
  - Biased container allocation (60/25/15, PG-heavy) for sub-1GB plans so Postgres's default `shared_buffers` isn't starved.
  - `sl instance create` defaults to `--plan hobby` (zero-friction entry). `sl instance resize` interactive prompt lists Hobby as the first option.
  - Dashboard `ProvisionStart` adds a Hobby card pre-selected by default.
  - Auto-resume on mint-ephemeral: every tenant-scoped CLI command that mints a 5-min JWT now transparently resumes a Hobby tenant that was auto-paused for idleness. Paid-tier manual suspensions (`sl instance suspend`) are never auto-resumed.
  - Dashboard banner copy differentiates Hobby auto-pause ("next CLI command auto-resumes") from paid-tier manual suspension.

- Updated dependencies [[`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11), [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`d16a3dd`](https://github.com/ryanwaits/secondlayer/commit/d16a3dd64e12d9c683ca4c5dcbb2c44837bdd5c6), [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c), [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4), [`1fe6d2b`](https://github.com/ryanwaits/secondlayer/commit/1fe6d2b168dba2e634bf87b69f155f25ad94a127), [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8), [`8f2d720`](https://github.com/ryanwaits/secondlayer/commit/8f2d72038c28aca7bd91efb4b0c93f72bac469d3), [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2), [`e7d93b3`](https://github.com/ryanwaits/secondlayer/commit/e7d93b3e054cd9e2656dfa1202c90b08ac5e7fa8), [`a74b01d`](https://github.com/ryanwaits/secondlayer/commit/a74b01d04ad901270a8592beef1a04db2250bb64)]:
  - @secondlayer/shared@3.0.0
  - @secondlayer/sdk@3.0.0
  - @secondlayer/stacks@1.0.0
  - @secondlayer/subgraphs@1.0.0
  - @secondlayer/bundler@0.3.1

## 3.2.0-beta.1

### Minor Changes

- Multi-format dispatch + `sl create subscription` scaffolder.

  - `@secondlayer/subgraphs`: 5 new format builders — Inngest events API, Trigger.dev v3 task trigger, Cloudflare Workflows, CloudEvents 1.0 structured JSON, and raw. The emitter dispatches on `subscription.format`; unknown values fall back to `standard-webhooks` with a warning log.
  - `@secondlayer/cli`: `sl create subscription <name> --runtime <inngest|trigger|cloudflare|node>` scaffolds a runtime-specific receiver project (package.json + src + README + tsconfig), then provisions the subscription via the SDK and writes the one-time signing secret into `.env`. Templates live at `packages/cli/templates/subscriptions/<runtime>/` and ship in the npm tarball.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@1.0.0-beta.2

## 3.1.2-alpha.0

### Patch Changes

- [`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Extend the README with a full `sl generate` section covering code generation against local `.clar` files, deployed contracts, and the plugin system (`clarinet`, `actions`, `react`, `testing`). Remove unused `secrets.ts` + `workflows.ts` command stubs that were never registered.

- [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Pricing foundation (Sprint A) — switch from 14-day trial to activity-based auto-pause, org-level billing prep.

  - Migration 0046 drops `tenants.trial_ends_at` + index, adds `tenants.last_active_at timestamptz NOT NULL DEFAULT now()` with index `(plan, last_active_at) WHERE status = 'active'`
  - Migration 0047 adds nullable `tenant_id` to `usage_daily` (+ best-effort backfill for single-tenant accounts), widens the unique key to `(account_id, tenant_id, date)` so Sprint-C Stripe metering can bill per-tenant
  - `TrialExpiredError` + `TRIAL_EXPIRED` code dropped (dead after trial removal)
  - New `bumpTenantActivity(slug)` + `listIdleHobbyTenants(idleSince)` query helpers
  - CLI drops trial-days-left from `sl instance info` and `sl whoami`, drops `TRIAL_EXPIRED` handlers

- [`9f7e3e6`](https://github.com/ryanwaits/secondlayer/commit/9f7e3e6299720c8883b03bbde55bd763d93d576c) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Pricing Sprint B — introduce the Hobby (free) plan + Nano compute.

  - New `hobby` PlanId in the provisioner + API routes + CLI. Nano spec: 0.5 vCPU / 512 MB RAM / 5 GB storage.
  - Biased container allocation (60/25/15, PG-heavy) for sub-1GB plans so Postgres's default `shared_buffers` isn't starved.
  - `sl instance create` defaults to `--plan hobby` (zero-friction entry). `sl instance resize` interactive prompt lists Hobby as the first option.
  - Dashboard `ProvisionStart` adds a Hobby card pre-selected by default.
  - Auto-resume on mint-ephemeral: every tenant-scoped CLI command that mints a 5-min JWT now transparently resumes a Hobby tenant that was auto-paused for idleness. Paid-tier manual suspensions (`sl instance suspend`) are never auto-resumed.
  - Dashboard banner copy differentiates Hobby auto-pause ("next CLI command auto-resumes") from paid-tier manual suspension.

- Updated dependencies [[`9fb9990`](https://github.com/ryanwaits/secondlayer/commit/9fb9990e99bbac053f15e6070a8c3c24da0c7c11), [`c201da9`](https://github.com/ryanwaits/secondlayer/commit/c201da96874da2ed34c3ab854b40344dd94d794c), [`5da9026`](https://github.com/ryanwaits/secondlayer/commit/5da9026271e4a3c7832af8c14579c2ad3b414db4), [`0459580`](https://github.com/ryanwaits/secondlayer/commit/04595805ece434021eca8e295c32c14e418d27d8), [`79f04c0`](https://github.com/ryanwaits/secondlayer/commit/79f04c06db14b22b053ac908eb68cbbaaa0d92d2)]:
  - @secondlayer/shared@3.0.0-alpha.0
  - @secondlayer/sdk@3.0.0-alpha.0
  - @secondlayer/stacks@1.0.0-alpha.0
  - @secondlayer/subgraphs@1.0.0-alpha.0
  - @secondlayer/bundler@0.3.1-alpha.0

## 3.1.1

### Patch Changes

- [`ca3feb0`](https://github.com/ryanwaits/secondlayer/commit/ca3feb00f85a58fa899ce873e9d2e0b7828c928c) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Ship a README with the CLI — documents the current command surface (auth, project, instance, subgraphs) + env vars + typed error codes. The npm page previously had no README because `README.md` wasn't in the package's `files` array.

## 3.1.0

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
  - @secondlayer/sdk@2.0.0

## 3.0.0

### Major Changes

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

### Patch Changes

- Updated dependencies [[`ebea60d`](https://github.com/ryanwaits/secondlayer/commit/ebea60da47f6fd12d1052166aa929951f5a0cb2b), [`7567649`](https://github.com/ryanwaits/secondlayer/commit/756764942865fbcc6d98608861abfbda2e175a86), [`26c090c`](https://github.com/ryanwaits/secondlayer/commit/26c090ce6290ddc5cf42ea8b72e87e80c1a3e786), [`416f7c4`](https://github.com/ryanwaits/secondlayer/commit/416f7c4a53bcc7c96362f23c19e9b715622819d7), [`2605a4f`](https://github.com/ryanwaits/secondlayer/commit/2605a4fb3b558c942cddef2955709088f1c67450)]:
  - @secondlayer/shared@2.0.0
  - @secondlayer/sdk@1.0.1
  - @secondlayer/subgraphs@0.11.8

## 2.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [[`4f1c7ea`](https://github.com/ryanwaits/secondlayer/commit/4f1c7eaa9242295972404174b24049c54d6b7a50), [`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955), [`7e1cf3d`](https://github.com/ryanwaits/secondlayer/commit/7e1cf3d4048b310c036ae30dac0d76f06d712375), [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1), [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3), [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01), [`696124e`](https://github.com/ryanwaits/secondlayer/commit/696124e115dc64d88eede394bbf422eb9a514849)]:
  - @secondlayer/workflows@1.1.0
  - @secondlayer/bundler@0.3.0
  - @secondlayer/shared@1.1.0
  - @secondlayer/stacks@0.3.0
  - @secondlayer/subgraphs@0.11.7

## 2.1.0

### Minor Changes

- [`3b6d671`](https://github.com/ryanwaits/secondlayer/commit/3b6d6715bd16a317b8aa22dd6590aec3771b2d4e) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Add `sl workflows templates` subcommand. Run with no arguments to list all built-in workflow templates, or pass an id (e.g. `sl workflows templates whale-alert`) to print that template's source to stdout — pipe it into `workflows/<name>.ts` as a starting point.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/workflows@1.0.1

## 2.0.0

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

- [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - Introduce `@secondlayer/bundler`: shared esbuild + validate helpers (`bundleSubgraphCode`, `bundleWorkflowCode`) with typed `BundleSizeError` and per-kind caps (subgraphs 4 MB, workflows 1 MB). MCP and CLI now consume it instead of inlining esbuild.
  - Persist workflow TypeScript source alongside the compiled handler (`workflow_definitions.source_code`, migration `0030`). `upsertWorkflowDefinition` bumps the patch version on every update and throws `VersionConflictError` when `expectedVersion` does not match the stored row.
  - Extend `DeployWorkflowRequestSchema` and the SDK/CLI deploy path with `sourceCode` + `expectedVersion`, so `sl workflows deploy` populates the new column and surfaces conflict detection.
- Updated dependencies [[`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5), [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9), [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7), [`d332f9c`](https://github.com/ryanwaits/secondlayer/commit/d332f9cb75638ff828ead721ce0e229100fd0e77), [`38e62e7`](https://github.com/ryanwaits/secondlayer/commit/38e62e74e600c353884fc89a5e22b8840a4d2689), [`eaa6115`](https://github.com/ryanwaits/secondlayer/commit/eaa61153f4a4247c42b132e022b5e972d2498883), [`e9c298c`](https://github.com/ryanwaits/secondlayer/commit/e9c298c828770e8ff538b957a7d7f38a7753900f), [`db333b1`](https://github.com/ryanwaits/secondlayer/commit/db333b1ea707516462f034ef13d37e5ff5fa01de)]:
  - @secondlayer/sdk@1.0.0
  - @secondlayer/shared@1.0.0
  - @secondlayer/workflows@1.0.0
  - @secondlayer/subgraphs@0.11.6
  - @secondlayer/bundler@0.2.0

## 1.12.2

### Patch Changes

- simplify gap display in subgraph status output

## 1.12.1

### Patch Changes

- fix(cli): only prompt confirmation for reindex, not fresh deploy

  Fresh deploys (new subgraph, no existing data) no longer show the destructive reindex confirmation prompt. The prompt now only appears when dropping and rebuilding existing data.

## 1.12.0

### Minor Changes

- feat(subgraphs): smart deploy — auto-versioning, auto-reindex, schema diff

  - System now owns versioning: patch auto-increments on every deploy (1.0.0 → 1.0.1); use --version flag for intentional bumps
  - Breaking schema changes auto-trigger reindex — no --reindex flag needed
  - Deploy output shows schema diff (added tables/columns, breaking changes, new version)
  - version field removed from schema hash so version bumps don't look like schema changes
  - --force flag skips reindex confirmation prompt
  - Handler code persisted in DB so container restarts don't break in-flight reindexes (migration 0029)

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@0.11.0
  - @secondlayer/shared@0.12.0
  - @secondlayer/sdk@0.10.2
  - @secondlayer/workflows@0.0.3

## 1.11.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.11.0
  - @secondlayer/subgraphs@0.10.0
  - @secondlayer/sdk@0.10.1
  - @secondlayer/workflows@0.0.2

## 1.11.0

### Minor Changes

- feat: add workflows support across packages

  - @secondlayer/sdk: add workflows client
  - @secondlayer/cli: add `sl workflows` commands
  - @secondlayer/mcp: add workflow tools for AI agents
  - @secondlayer/indexer: add tx repair script for missing function_args and raw_result

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.10.0

## 1.10.1

### Patch Changes

- 885662d: feat(subgraphs): named-object sources with SubgraphFilter discriminated union

  Breaking: sources changed from `SubgraphSource[]` to `Record<string, SubgraphFilter>`. Handler keys are now source names, not derived sourceKey strings. Event data auto-unwrapped via cvToValue. New context methods: patch, patchOrInsert, formatUnits, aggregates.

- Updated dependencies [885662d]
  - @secondlayer/subgraphs@0.9.0
  - @secondlayer/shared@0.10.1
  - @secondlayer/sdk@0.9.1

## 1.10.0

### Minor Changes

- Deploy-resilient reindexing: abort support, auto-resume on startup, graceful shutdown, and `sl subgraphs stop` command.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.10.0
  - @secondlayer/subgraphs@0.8.0
  - @secondlayer/sdk@0.9.0

## 1.9.0

### Minor Changes

- Add 6-digit login code alongside magic link for dual auth (code entry + link click).

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.9.0
  - @secondlayer/sdk@0.8.1
  - @secondlayer/subgraphs@0.7.2

## 1.8.0

### Minor Changes

- [`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Add subgraph gap detection, tracking, and backfill across runtime, API, SDK, and CLI

### Patch Changes

- Updated dependencies [[`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757)]:
  - @secondlayer/shared@0.8.0
  - @secondlayer/subgraphs@0.7.0
  - @secondlayer/sdk@0.8.0

## 1.7.0

### Minor Changes

- Add `subgraphs.backfill()` SDK method and `sl subgraphs backfill` CLI command for non-destructive block range re-processing.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.7.0
  - @secondlayer/subgraphs@0.6.0
  - @secondlayer/shared@0.7.1

## 1.6.8

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.7.0
  - @secondlayer/sdk@0.6.4
  - @secondlayer/subgraphs@0.5.7

## 1.6.7

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.6.0
  - @secondlayer/stacks@0.2.2
  - @secondlayer/sdk@0.6.3
  - @secondlayer/subgraphs@0.5.6

## 1.6.6

### Patch Changes

- Migrate all zod imports from v3 compat layer to zod/v4 and fix type errors.

- Updated dependencies []:
  - @secondlayer/shared@0.5.1
  - @secondlayer/subgraphs@0.5.5

## 1.6.5

### Patch Changes

- Coerce numeric columns to BigInt in findOne/findMany results so arithmetic works correctly in handlers.

- Updated dependencies []:
  - @secondlayer/subgraphs@0.5.2

## 1.6.4

### Patch Changes

- CLI: bundle updated SDK with query response unwrap fix. Subgraphs: use NUMERIC for uint/int columns to handle Clarity values > bigint max.

- Updated dependencies []:
  - @secondlayer/subgraphs@0.5.1

## 1.6.3

### Patch Changes

- Serialize subgraph source objects to strings before sending to deploy API, fixing "Expected string, received object" error.

## 1.6.2

### Patch Changes

- Route ABI fetches through SecondLayer API proxy instead of Hiro public API.

## 1.6.1

### Patch Changes

- Prefer STACKS_NODE_RPC_URL over Hiro public API for ABI fetches in scaffold/generate commands.

## 1.6.0

### Minor Changes

- 4b716bd: Rename "views" product to "subgraphs" across entire codebase. Package `@secondlayer/views` is deprecated in favor of `@secondlayer/subgraphs`. All types, functions, API routes, CLI commands, and DB tables renamed accordingly.

### Patch Changes

- Updated dependencies [4b716bd]
  - @secondlayer/shared@0.5.0
  - @secondlayer/subgraphs@0.5.0
  - @secondlayer/sdk@0.6.0

## 1.5.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.5.0
  - @secondlayer/shared@0.4.0
  - @secondlayer/stacks@0.2.0
  - @secondlayer/views@0.3.0

## 1.5.0

### Minor Changes

- Replace session tokens with API keys as sole CLI credential. Login now creates a `cli-<hostname>` API key via temporary session, logout revokes it server-side, and sessionToken is removed from config.

## 1.4.1

### Patch Changes

- Updated dependencies [48e42ba]
- Updated dependencies [a070de2]
  - @secondlayer/shared@0.3.0
  - @secondlayer/stacks@0.1.0
  - @secondlayer/sdk@0.4.1
  - @secondlayer/views@0.2.4

## 1.4.0

### Minor Changes

- Add `getView()` standalone factory to `@secondlayer/sdk`. Mirrors `getContract()` — accepts a view def + plain options, `SecondLayer`, or `Views` instance; no `SecondLayer` instantiation required for view-only use cases.

  Generated `createClient` from `sl views generate` now takes `options?: { apiKey?: string; baseUrl?: string }` instead of `sl: SecondLayer`.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.4.0

## 1.3.0

### Minor Changes

- Add whoami command, --network global flag, hosted-mode doctor, testnet in setup wizard, shared 401 error handler with auth guidance, replace raw stdin with inquirer in auth login, hide local-only config for hosted users, improve webhook template, fix stale command references, remove duplicate top-level logs command

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.3.1

## 1.2.4

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.4
  - @secondlayer/shared@0.2.3
  - @secondlayer/views@0.2.3

## 1.2.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.3
  - @secondlayer/shared@0.2.2
  - @secondlayer/views@0.2.2

## 1.2.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.0.2
  - @secondlayer/shared@0.2.1
  - @secondlayer/views@0.2.1

## 1.2.1

### Patch Changes

- Restructure SDK into subpath exports (`@secondlayer/sdk/streams`, `@secondlayer/sdk/views`). Replace `StreamsClient` with `SecondLayer` class composing `Streams` and `Views` domain clients. Extract `BaseClient` abstract with shared request/auth logic. Default baseUrl to `https://api.secondlayer.io`.

- Updated dependencies []:
  - @secondlayer/sdk@0.3.0

## 1.2.0

### Minor Changes

- Migrate code formatter from Prettier to Biome JS API with import sorting and tabs

## 1.1.0

### Minor Changes

- feat(actions): optional senderKey with STX_SENDER_KEY env var fallback

## 1.0.0

### Major Changes

- BREAKING: Renamed all Stacks/Codegen references to SecondLayer
  - `StacksConfig` → `SecondLayerConfig`
  - `StacksCodegenPlugin` → `SecondLayerPlugin`
  - `StacksReactConfig` → `SecondLayerReactConfig`
  - `StacksProvider` → `SecondLayerProvider`
  - `useStacksConfig` → `useSecondLayerConfig`
  - `createStacksConfig` → `createSecondLayerConfig`
  - Config file: `stacks.config.ts` → `secondlayer.config.ts`

## 0.3.10

### Patch Changes

- Updated dependencies []:
  - @secondlayer/clarity-types@0.5.0

## 0.3.9

### Patch Changes

- fix: consolidated audit fixes - config regex, missing imports, type validation, error handling, code deduplication

- Updated dependencies []:
  - @secondlayer/clarity-types@0.4.2

## 0.3.8

### Patch Changes

- Fix generated code linting: map Clarity `none` type to TypeScript `null` instead of `any`

  This fixes Biome and other linter warnings for response types like `{ ok: null } | { err: bigint }` in generated constant getters.

## 0.3.7

### Patch Changes

- Hardening improvements based on audit findings:
  - Add composite type validation for lists (max length), tuples (required fields), and responses (ok/err shape)
  - Create ABI normalization layer for format compatibility (buffer/buff, read_only/read-only)
  - Enhance principal validation with contract name format checking
  - Consolidate type mapping utilities into shared module
  - Remove @secondlayer/clarity-types dependency from generated code for better DX
  - Inline validation utilities in generated code (CONTRACT_NAME_REGEX)

## 0.3.6

### Patch Changes

- Add composite type validation and consolidate shared utilities

  - Add validation for lists (max length), tuples (required fields), and responses (ok/err shape)
  - Add contract name format validation for principals
  - Create ABI normalization layer for buffer/buff and read_only/read-only compatibility
  - Consolidate toCamelCase implementations into clarity-types
  - Consolidate type mapping utilities into shared module

- Updated dependencies []:
  - @secondlayer/clarity-types@0.4.1

## 0.3.5

### Patch Changes

- Updated dependencies []:
  - @secondlayer/clarity-types@0.4.0

## 0.3.4

### Patch Changes

- Simplify generate command output to single success message

## 0.3.3

### Patch Changes

- Fix contractName to use original kebab-case for API calls while keeping camelCase for JS exports
  - Preserve `_directFile` flag through contract config transformation
  - Extract original contract name from address for API endpoints (vars, constants, maps)
  - Maintains `sbtcToken` for JS imports but uses `sbtc-token` for API URLs

## 0.3.2

### Patch Changes

- Fix lint issues in generated code and improve dependency DX
  - Remove useless else clauses after return statements (noUselessElse)
  - Replace control character regex with charCodeAt for ASCII detection (noControlCharactersInRegex)
  - Add warning when @stacks/transactions peer dependency is missing
  - Add @requires JSDoc tag to generated file header

## 0.3.1

### Patch Changes

- Auto-infer network from contract address prefix (SP/SM = mainnet, ST/SN = testnet) for maps, variables, constants, and read helpers. Network parameter is now optional with explicit override still supported for devnet testing.

## 0.3.0

### Minor Changes

- Add support for contract state (maps, variables, and constants)
  - Generate typed `maps` object with `get()` methods for reading map entries via Hiro API
  - Generate typed `vars` object with `get()` methods for reading data variables
  - Generate typed `constants` object with `get()` methods for reading contract constants
  - Add React hooks for maps (`useContractMapName`), variables (`useContractVarName`), and constants (`useContractConstantName`)
  - Constants hooks use `staleTime: Infinity` since values never change
  - Parse maps and variables from Hiro API contract interface responses

### Patch Changes

- Fix type safety for complex Clarity types in React hooks

  - Fix `mapClarityTypeToTS` to properly handle response, tuple, list, and optional types
  - React hooks now return proper TypeScript types instead of `any` for complex return values
  - Fix PostCondition types (use `PostCondition[]` instead of `any[]`)
  - Add proper parentheses for union types in list contexts (e.g., `(string | null)[]`)

- Updated dependencies []:
  - @secondlayer/clarity-types@0.3.0

## 0.2.5

### Patch Changes

- Fix issue with CommonJS bundling

- Updated dependencies []:
  - @secondlayer/clarity-types@0.2.2

## 0.2.4

### Patch Changes

- Clean up eager imports and heavy deps

- Updated dependencies []:
  - @secondlayer/clarity-types@0.2.1

## 0.2.3

### Patch Changes

- Fix --version flag to read version dynamically from package.json

## 0.2.2

### Patch Changes

- Replace Bun.Glob with fast-glob for Node.js compatibility

## 0.2.1

### Patch Changes

- Fix workspace dependency resolution for @secondlayer/clarity-types

## 0.2.0

### Minor Changes

- Initial monorepo release. The CLI now includes a new testing plugin for Clarinet SDK integration, and type inference is powered by the new @secondlayer/clarity-types package with runtime validation guards and value converters.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/clarity-types@0.2.0
