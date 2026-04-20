# @secondlayer/sdk

## 2.0.0

### Major Changes

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

## 1.0.1

### Patch Changes

- Updated dependencies [[`ebea60d`](https://github.com/ryanwaits/secondlayer/commit/ebea60da47f6fd12d1052166aa929951f5a0cb2b), [`7567649`](https://github.com/ryanwaits/secondlayer/commit/756764942865fbcc6d98608861abfbda2e175a86), [`26c090c`](https://github.com/ryanwaits/secondlayer/commit/26c090ce6290ddc5cf42ea8b72e87e80c1a3e786), [`416f7c4`](https://github.com/ryanwaits/secondlayer/commit/416f7c4a53bcc7c96362f23c19e9b715622819d7), [`2605a4f`](https://github.com/ryanwaits/secondlayer/commit/2605a4fb3b558c942cddef2955709088f1c67450)]:
  - @secondlayer/shared@2.0.0
  - @secondlayer/subgraphs@0.11.8

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

### Minor Changes

- [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Server-side subgraph bundler + source capture, mirroring the workflows authoring loop.

  - **API**: new `POST /api/subgraphs/bundle` runs `bundleSubgraphCode` from `@secondlayer/bundler` and returns `{ name, version, sources, schema, handlerCode, sourceCode, bundleSize }`. `BundleSizeError → 413`, other failures → 400 with `code: "BUNDLE_FAILED"`. New `GET /api/subgraphs/:name/source` returns the original TypeScript source for deployed subgraphs, or a `readOnly` payload for rows predating the migration. `POST /api/subgraphs` now threads `sourceCode` through `deploySchema` so the original source is persisted on deploy.
  - **SDK**: new `subgraphs.bundle({ code })` and `subgraphs.getSource(name)` methods + `BundleSubgraphResponse` / `SubgraphSource` types.
  - **shared**: migration `0031_subgraph_source_code` adds `source_code TEXT NULL` to the `subgraphs` table; `registerSubgraph` upsert + `DeploySubgraphRequest` schema both accept an optional `sourceCode` field (max 1MB).
  - **subgraphs**: `deploySchema()` accepts `sourceCode` in its options and forwards it to `registerSubgraph`.

  Unlocks the next wave of the chat authoring loop (read/edit/deploy/tail subgraphs in a session).

- [`d332f9c`](https://github.com/ryanwaits/secondlayer/commit/d332f9cb75638ff828ead721ce0e229100fd0e77) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Move workflow bundling from Vercel to the Hetzner API.

  - **API**: new `POST /api/workflows/bundle` route that accepts a TypeScript workflow source, runs `bundleWorkflowCode` from `@secondlayer/bundler`, and returns the bundled handler + extracted metadata. Mapped via the existing `/api/workflows/*` auth + rate-limit middleware. `BundleSizeError` → `HTTP 413`, other failures → `HTTP 400`. Logs every request with `x-sl-origin` + `bundleSize` for telemetry parity with deploy logs.
  - **SDK**: new `workflows.bundle({ code })` method plus `BundleWorkflowResponse` type.
  - **Web**: `POST /api/sessions/bundle-workflow` rewritten as a thin direct-fetch passthrough to the Hetzner API. `@secondlayer/bundler` is no longer a dependency of `apps/web` and `esbuild` is no longer in `serverExternalPackages`. Vercel cold starts drop esbuild's native binary from the hot path. CLI and MCP continue to bundle locally — this only affects the chat authoring loop.

  This fixes a class of `"Module evaluation failed: Cannot find module 'unknown'"` / `NameTooLong` / `Could not resolve "@secondlayer/workflows"` failures that kept surfacing when esbuild ran inside Vercel serverless functions. Chat deploy flow now goes Vercel → Hetzner `/api/workflows/bundle` → Hetzner `/api/workflows` → workflow-runner, all against stable workspace layouts.

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

- [`db333b1`](https://github.com/ryanwaits/secondlayer/commit/db333b1ea707516462f034ef13d37e5ff5fa01de) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Live-tail workflow runs over SSE:

  - API: new `GET /api/workflows/:name/runs/:runId/stream` Hono `streamSSE` route. Emits an initial snapshot of `workflow_steps`, polls every 500ms for status diffs, pushes `step`, `heartbeat`, `done`, and `timeout` events, and caps at 30 minutes (matches `logs.ts`).
  - SDK: typed `workflows.streamRun(name, runId, onEvent, signal)` plus shared `WorkflowStepEvent` / `WorkflowTailEvent` types. Uses the native `fetch` streaming response so callers can carry `x-sl-origin` headers alongside Bearer auth.
  - MCP: new `workflows_tail_run` tool that wraps `streamRun` and returns a compacted log of up to `limit` events or until the run completes / `timeoutMs` elapses — MCP is not streaming-first, so this is a bounded collect-and-return.
  - Web: new `tail_workflow_run` session tool that emits `{ name, runId }` and a client-side `StepFlowLive` component that opens an SSE proxy route (`/api/sessions/tail-workflow-run/[name]/[runId]`) and animates the `StepFlow` timeline as events arrive. The deploy-success card's **Tail live runs** CTA is now wired — it triggers a run if the user hasn't already, then mounts the live timeline in-card.

### Patch Changes

- [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - Introduce `@secondlayer/bundler`: shared esbuild + validate helpers (`bundleSubgraphCode`, `bundleWorkflowCode`) with typed `BundleSizeError` and per-kind caps (subgraphs 4 MB, workflows 1 MB). MCP and CLI now consume it instead of inlining esbuild.
  - Persist workflow TypeScript source alongside the compiled handler (`workflow_definitions.source_code`, migration `0030`). `upsertWorkflowDefinition` bumps the patch version on every update and throws `VersionConflictError` when `expectedVersion` does not match the stored row.
  - Extend `DeployWorkflowRequestSchema` and the SDK/CLI deploy path with `sourceCode` + `expectedVersion`, so `sl workflows deploy` populates the new column and surfaces conflict detection.
- Updated dependencies [[`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5), [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9), [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7), [`38e62e7`](https://github.com/ryanwaits/secondlayer/commit/38e62e74e600c353884fc89a5e22b8840a4d2689), [`eaa6115`](https://github.com/ryanwaits/secondlayer/commit/eaa61153f4a4247c42b132e022b5e972d2498883), [`e9c298c`](https://github.com/ryanwaits/secondlayer/commit/e9c298c828770e8ff538b957a7d7f38a7753900f)]:
  - @secondlayer/shared@1.0.0
  - @secondlayer/workflows@1.0.0
  - @secondlayer/subgraphs@0.11.6

## 0.10.3

### Patch Changes

- Add verifyWebhookSignature helper for verifying x-secondlayer-signature HMAC headers on webhook deliveries

## 0.10.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@0.11.0
  - @secondlayer/shared@0.12.0
  - @secondlayer/workflows@0.0.3

## 0.10.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.11.0
  - @secondlayer/subgraphs@0.10.0
  - @secondlayer/workflows@0.0.2

## 0.10.0

### Minor Changes

- feat: add workflows support across packages

  - @secondlayer/sdk: add workflows client
  - @secondlayer/cli: add `sl workflows` commands
  - @secondlayer/mcp: add workflow tools for AI agents
  - @secondlayer/indexer: add tx repair script for missing function_args and raw_result

## 0.9.1

### Patch Changes

- Updated dependencies [885662d]
  - @secondlayer/subgraphs@0.9.0
  - @secondlayer/shared@0.10.1

## 0.9.0

### Minor Changes

- Deploy-resilient reindexing: abort support, auto-resume on startup, graceful shutdown, and `sl subgraphs stop` command.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.10.0
  - @secondlayer/subgraphs@0.8.0

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.9.0
  - @secondlayer/subgraphs@0.7.2

## 0.8.0

### Minor Changes

- [`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Add subgraph gap detection, tracking, and backfill across runtime, API, SDK, and CLI

### Patch Changes

- Updated dependencies [[`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757)]:
  - @secondlayer/shared@0.8.0
  - @secondlayer/subgraphs@0.7.0

## 0.7.0

### Minor Changes

- Add `subgraphs.backfill()` SDK method and `sl subgraphs backfill` CLI command for non-destructive block range re-processing.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@0.6.0
  - @secondlayer/shared@0.7.1

## 0.6.4

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.7.0
  - @secondlayer/subgraphs@0.5.7

## 0.6.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.6.0
  - @secondlayer/subgraphs@0.5.6

## 0.6.2

### Patch Changes

- fix(subgraphs): fix Zod v4 type cast in validate.ts
  chore(sdk): remove dangling ./contracts export
- Updated dependencies []:
  - @secondlayer/subgraphs@0.5.3

## 0.6.1

### Patch Changes

- Fix subgraph queryTable to unwrap `data` field from API response.

## 0.6.0

### Minor Changes

- 4b716bd: Rename "views" product to "subgraphs" across entire codebase. Package `@secondlayer/views` is deprecated in favor of `@secondlayer/subgraphs`. All types, functions, API routes, CLI commands, and DB tables renamed accordingly.

### Patch Changes

- Updated dependencies [4b716bd]
  - @secondlayer/shared@0.5.0
  - @secondlayer/subgraphs@0.5.0

## 0.5.0

### Minor Changes

- Add SDK README with comprehensive examples. Fix error serialization for non-string bodies. Validate orderBy accepts only single column. Handle limit=0 correctly in listDeliveries. Remove Contracts client in favor of views system.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/shared@0.4.0
  - @secondlayer/views@0.3.0

## 0.4.1

### Patch Changes

- Updated dependencies [48e42ba]
  - @secondlayer/shared@0.3.0
  - @secondlayer/views@0.2.4

## 0.4.0

### Minor Changes

- Add `getView()` standalone factory to `@secondlayer/sdk`. Mirrors `getContract()` — accepts a view def + plain options, `SecondLayer`, or `Views` instance; no `SecondLayer` instantiation required for view-only use cases.

  Generated `createClient` from `sl views generate` now takes `options?: { apiKey?: string; baseUrl?: string }` instead of `sl: SecondLayer`.

## 0.3.1

### Patch Changes

- Fix API base URL (secondlayer.io → secondlayer.tools)

## 0.3.0

### Minor Changes

- Restructure SDK into subpath exports (`@secondlayer/sdk/streams`, `@secondlayer/sdk/views`). Replace `StreamsClient` with `SecondLayer` class composing `Streams` and `Views` domain clients. Extract `BaseClient` abstract with shared request/auth logic. Default baseUrl to `https://api.secondlayer.io`.

## 0.2.0

### Minor Changes

- Add @secondlayer/sdk - TypeScript client for SecondLayer API with stream management, view queries, and queue stats
