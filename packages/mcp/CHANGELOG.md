# @secondlayer/mcp

## 3.3.0

### Minor Changes

- a777de7: Add an agent orientation snapshot available to every surface, not just MCP. `SecondLayer.context()` (SDK) assembles, concurrently and degrading to `null` per field, the account, live Streams + Index tips, your subgraphs/subscriptions (with a per-status breakdown), and any in-flight reindex operations. The MCP `secondlayer://context` resource now builds on this — so it gains the tips, subscription health, and in-flight operations it lacked — and `sl context` (CLI) prints the same snapshot so non-MCP agents aren't context-starved.
- e0f9499: Agent-reachable, hardened API-key mint. A headless agent holding an account-level (owner) key can now self-provision a SCOPED `streams`/`index` read key via `POST /v1/api-keys` — no dashboard. The minted key is always scoped (never an account/superkey), inherits the account plan's tier, is per-IP rate limited, and is bounded by a per-account active-key ceiling. Surfaced as `sl.apiKeys.create()` (SDK), `sl keys create` (CLI), and the `account_create_key` MCP tool.

  Also closes a privilege-escalation hole on the existing `POST /api/keys`: it accepted any valid credential and did no product check, so a leaked scoped key could mint an account superkey. Minting is now owner-gated (a dashboard session or an `account`-product key), and non-session callers are confined to scoped keys with an inherited tier.

- a9be0a3: Let an agent read its own consumption and limits. `GET /v1/streams/usage` and `GET /v1/index/usage` return the account's events today + this month for that product plus its tier limits (Streams: rate limit + retention days; Index: rate limit), reusing the existing metering. Streams is key-mandatory; Index requires a Build+ key (anonymous → 401). Surfaced as `sl.streams.usage()` / `sl.index.usage()` (SDK) and the `streams_usage` / `index_usage` MCP tools, and listed in the `/v1/streams` and `/v1/index` discovery routes.
- 1f23b96: Bring the MCP tool surface to parity with the SDK for Index and Streams. Adds Index tools for the remaining families — `index_canonical`, `index_blocks`, `index_transactions`, `index_stacking`, `index_mempool`, plus get-by-id (`index_block`, `index_transaction`, `index_mempool_tx`) — and Streams tools `streams_event_by_txid`, `streams_block_events`, `streams_reorgs`, and `streams_canonical`. Also fixes `streams_events` block-range filtering, which declared `fromBlock`/`toBlock` while the API expects `fromHeight`/`toHeight`, so those filters were silently dropped.
- 22725d0: Expose subgraph operation status so agents can poll a reindex/backfill to completion instead of guessing. `reindex`/`backfill`/`stop` already return an `operationId`; now `GET /api/subgraphs/:name/operations/:id` returns that operation's live status (kind, status, processed blocks, a derived 0–1 progress, error, timestamps), and `GET /api/subgraphs/:name/operations` lists recent operations. Surfaced as `sl.subgraphs.getOperation(name, id)` / `sl.subgraphs.operations(name)` (SDK) and the `subgraphs_operation` MCP tool. Backed by the existing `subgraph_operations` table — no migration.

### Patch Changes

- 80433eb: Consolidate the decoded event-type vocabulary into a single `@secondlayer/shared` source (`DECODED_EVENT_TYPES`, `STREAMS_EVENT_TYPES`, and the now-exported `CHAIN_TRIGGER_TYPES`), replacing the duplicate literal copies in the SDK, indexer, and MCP tools. The MCP context resource now generates its `whatYouCanDo` capability list from the live tool registry, so it can no longer drift behind the actual tool surface.
- Updated dependencies [a777de7]
- Updated dependencies [80433eb]
- Updated dependencies [e0f9499]
- Updated dependencies [a9be0a3]
- Updated dependencies [22725d0]
  - @secondlayer/sdk@6.9.0
  - @secondlayer/shared@6.18.0

## 3.2.0

### Minor Changes

- bb96d3f: feat: `trigger.*` chain-subscription builders + MCP chain support

  Expose ergonomic chain-trigger builders for direct chain-level subscriptions from the SDK root, and let the MCP `subscriptions_create` tool create chain subscriptions.

  - SDK now exports `trigger` (`import { trigger } from "@secondlayer/sdk"`) with one builder per event type (`trigger.contractCall`, `trigger.ftTransfer`, …), plus the `ChainTrigger` / `SubscriptionKind` types. Use as `subscriptions.create({ triggers: [trigger.contractCall({ ... })] })`. Raw `triggers` objects still work. (Renamed from the previously-unreachable `on` export to avoid colliding with `@secondlayer/stacks`'s subgraph-source `on`.)
  - MCP `subscriptions_create` accepts a `triggers` array (chain subscription) as an alternative to `subgraphName`/`tableName` (subgraph subscription).

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@6.8.0

## 3.1.1

### Patch Changes

- 43325d9: Sync package READMEs with the newly added surfaces: SDK datasets/contracts root clients, MCP datasets/index/streams/contracts tools + `secondlayer://context` resource + account update/billing, and CLI `sl index` / `projects delete` / data-products read commands.
- Updated dependencies:
  - @secondlayer/sdk@6.2.1

## 3.1.0

### Minor Changes

- 48f0ab6: Add `account_update` (PATCH profile: display_name, bio, slug) and `account_billing` (plan + subscription status) tools so the MCP account surface matches the CLI's `account get/update/billing`.
- 86a7711: Add a live `secondlayer://context` resource so a connecting agent learns what exists (its subgraphs + freshness, subscriptions, account/plan), what it can do (the product surfaces and their key tools), and the per-product read-auth tiers. Every live call degrades gracefully when keyless, so the resource never throws.
- 0967b9a: Add read tools for the core data products so an MCP agent can reach them directly: `datasets_list`/`datasets_query` (Foundation Datasets), `index_ft_transfers`/`index_nft_transfers`/`index_events`/`index_contract_calls` (decoded Index layer, mirroring the SDK surface), `streams_tip`/`streams_events` (Streams firehose, with an API-key hint on keyless auth failures), and `contracts_find` (trait-based contract discovery).

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@6.2.0

## 3.0.1

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@6.0.0

## 3.0.0

### Major Changes

- 76caa66: Remove the `SL_SERVICE_KEY` and `SECONDLAYER_API_KEY` env-var aliases — the MCP server now reads only `SL_API_KEY`, matching the CLI and SDK. (The previous release accepted them as deprecated aliases with a warning.) Update any MCP config that still sets `SL_SERVICE_KEY` to use `SL_API_KEY`.

## 2.4.0

### Minor Changes

- b4c3fee: Standardize on `SL_API_KEY` for the MCP server's API credential, matching the CLI and SDK. `SL_SERVICE_KEY` and `SECONDLAYER_API_KEY` continue to work as deprecated aliases (logged once per process), so existing MCP configs keep functioning. README and config examples now lead with `SL_API_KEY`.

## 2.3.5

### Patch Changes

- 5766f99: Allow keyless reads. The MCP server no longer requires `SL_SERVICE_KEY` to start — read tools (`list`, `get`, `query`, `spec`) work without a key during open beta, and only writes/account tools need an `sk-sl_` key. Also fixes a stale error message that referenced the removed `sl instance info` command.

## 2.3.4

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@5.0.0

## 2.3.3

### Patch Changes

- 229c297: Add license, repository, and homepage metadata plus a bundled LICENSE file; drop src from clarity-docs npm files.
- Updated dependencies:
  - @secondlayer/bundler@0.3.7
  - @secondlayer/scaffold@1.0.6
  - @secondlayer/sdk@4.0.2

## 2.3.2

### Patch Changes

- 71e80cd: chore(deps): bump @secondlayer/sdk to v4

  Pulls in the fix to `verifyWebhookSignature` (now validates the real Standard Webhooks delivery headers). Neither package calls `verifyWebhookSignature` directly, so no consumer-facing behavior changes here.

- Updated dependencies:
  - @secondlayer/sdk@4.0.0

## 2.3.1

### Patch Changes

- Updated dependencies:
  - @secondlayer/bundler@0.3.4
  - @secondlayer/scaffold@1.0.3
  - @secondlayer/sdk@3.3.1

## 2.3.0

### Minor Changes

- f8645e8: Add generated subgraph API specs for OpenAPI, compact agent schemas, and Markdown docs across shared, SDK, CLI, and MCP surfaces.

### Patch Changes

- Updated dependencies:
  - @secondlayer/sdk@3.3.0

## 2.2.0

### Minor Changes

- Add CLI bearer-token subscription auth, deploy-time subgraph startBlock overrides, and MCP deploy startBlock support.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@3.2.0

## 2.1.1

### Patch Changes

- Align subscription create/update request typing with the current SDK contract.

## 2.1.0

### Minor Changes

- Add the agent-native subscription golden path: shared subscription schemas, schema-aware API and CLI validation, first-class `sl subscriptions` lifecycle commands, MCP lifecycle parity, and updated subscription docs.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@3.1.0

## 2.0.1

### Patch Changes

- README switched to `bunx` invocation; added agent golden-path section. Minor `tools/subgraphs.ts` nit.

- Updated dependencies []:
  - @secondlayer/scaffold@1.0.2
  - @secondlayer/sdk@3.0.1

## 2.0.0

### Major Changes

- [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Drop sentry tools (`manage_sentries`, `check_sentries`, `list_sentry_kinds`). MCP clients must restart after upgrade so the tool schema cache refreshes.

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

- [`1fe6d2b`](https://github.com/ryanwaits/secondlayer/commit/1fe6d2b168dba2e634bf87b69f155f25ad94a127) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Replay + DLQ + MCP subscription tools.

  - `@secondlayer/subgraphs`: new `replaySubscription({ accountId, subscriptionId, fromBlock, toBlock })` re-enqueues historical rows as outbox entries marked `is_replay=TRUE`. Emitter claims batches 90/10 live vs replay so replays never starve live deliveries.
  - `@secondlayer/sdk`: `sl.subscriptions.replay(id, range)`, `recentDeliveries(id)`, `dead(id)`, `requeueDead(id, outboxId)`.
  - `@secondlayer/mcp`: 7 new subscription tools — `subscriptions_list|get|create|update|delete|replay|recent_deliveries`. Restart MCP clients after upgrade so the tool cache refreshes.
  - Dashboard subscription detail: replay dialog (block range prompt) + DLQ tab listing dead rows with one-click requeue.
  - API: `POST /api/subscriptions/:id/replay`, `GET .../dead`, `POST .../dead/:outboxId/requeue`.

### Patch Changes

- Updated dependencies [[`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`d16a3dd`](https://github.com/ryanwaits/secondlayer/commit/d16a3dd64e12d9c683ca4c5dcbb2c44837bdd5c6), [`1fe6d2b`](https://github.com/ryanwaits/secondlayer/commit/1fe6d2b168dba2e634bf87b69f155f25ad94a127), [`e7d93b3`](https://github.com/ryanwaits/secondlayer/commit/e7d93b3e054cd9e2656dfa1202c90b08ac5e7fa8), [`a74b01d`](https://github.com/ryanwaits/secondlayer/commit/a74b01d04ad901270a8592beef1a04db2250bb64)]:
  - @secondlayer/sdk@3.0.0
  - @secondlayer/subgraphs@1.0.0
  - @secondlayer/scaffold@1.0.1
  - @secondlayer/bundler@0.3.1

## 2.0.0-beta.1

### Minor Changes

- Replay + DLQ + MCP subscription tools.

  - `@secondlayer/subgraphs`: new `replaySubscription({ accountId, subscriptionId, fromBlock, toBlock })` re-enqueues historical rows as outbox entries marked `is_replay=TRUE`. Emitter claims batches 90/10 live vs replay so replays never starve live deliveries.
  - `@secondlayer/sdk`: `sl.subscriptions.replay(id, range)`, `recentDeliveries(id)`, `dead(id)`, `requeueDead(id, outboxId)`.
  - `@secondlayer/mcp`: 7 new subscription tools — `subscriptions_list|get|create|update|delete|replay|recent_deliveries`. Restart MCP clients after upgrade so the tool cache refreshes.
  - Dashboard subscription detail: replay dialog (block range prompt) + DLQ tab listing dead rows with one-click requeue.
  - API: `POST /api/subscriptions/:id/replay`, `GET .../dead`, `POST .../dead/:outboxId/requeue`.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@1.0.0-beta.3
  - @secondlayer/sdk@3.0.0-beta.2

## 2.0.0-alpha.0

### Major Changes

- Drop sentry tools (`manage_sentries`, `check_sentries`, `list_sentry_kinds`). MCP clients must restart after upgrade so the tool schema cache refreshes.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@3.0.0-alpha.0
  - @secondlayer/subgraphs@1.0.0-alpha.0
  - @secondlayer/scaffold@1.0.1-alpha.0
  - @secondlayer/bundler@0.3.1-alpha.0

## 1.1.0

### Minor Changes

- [`437ffff`](https://github.com/ryanwaits/secondlayer/commit/437fffff1dda97ee9e226f5b7b165d68d341128f) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - Accept `SL_SERVICE_KEY` as the canonical env var name. `SECONDLAYER_API_KEY` keeps working as a deprecated alias and logs a one-time warning per process so existing integrations don't break.
  - Register workflow tools on the MCP server (`workflows_list`, `workflows_get`, `workflows_trigger`, `workflows_pause`, `workflows_resume`, `workflows_runs`, and the deploy/scaffold/rollback variants). Previously defined but not wired into `createServer`.

## 1.0.2

### Patch Changes

- Updated dependencies [[`2024259`](https://github.com/ryanwaits/secondlayer/commit/2024259c0a474dcede50fa8d6fb4018877632435)]:
  - @secondlayer/sdk@2.0.0

## 1.0.1

### Patch Changes

- Updated dependencies [[`4f1c7ea`](https://github.com/ryanwaits/secondlayer/commit/4f1c7eaa9242295972404174b24049c54d6b7a50), [`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955), [`7e1cf3d`](https://github.com/ryanwaits/secondlayer/commit/7e1cf3d4048b310c036ae30dac0d76f06d712375), [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1), [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3), [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01)]:
  - @secondlayer/workflows@1.1.0
  - @secondlayer/bundler@0.3.0
  - @secondlayer/subgraphs@0.11.7

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

- [`e15849e`](https://github.com/ryanwaits/secondlayer/commit/e15849e704b02818c5e91e09f17f95e489fb181c) Thanks [@ryanwaits](https://github.com/ryanwaits)! - MCP parity for subgraph source capture.

  - New `subgraphs_read_source` tool wraps `GET /api/subgraphs/:name/source` so external MCP clients (Claude Desktop, Inspector) can fetch deployed TypeScript source. Mirrors the `read_subgraph` web chat tool and returns the same `{ readOnly, reason }` payload for subgraphs deployed before source capture landed.
  - `subgraphs_deploy` now threads `sourceCode` (the raw TypeScript passed in) into the deploy call so MCP-deployed subgraphs show up in the chat authoring loop's read/edit flow alongside web-deployed ones.

- [`38e62e7`](https://github.com/ryanwaits/secondlayer/commit/38e62e74e600c353884fc89a5e22b8840a4d2689) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - `POST /api/workflows` now maps `VersionConflictError` to HTTP 409 `{ error, code, currentVersion, expectedVersion }`, reads `x-sl-origin: cli|mcp|session` for telemetry, and logs every deploy. The response body now includes the resolved `version`.

  - Added `dryRun: true` mode on `POST /api/workflows` — validates the bundle via data-URI import, skips disk and DB writes, and returns `{ valid, validation, bundleSize }`.
  - Added `GET /api/workflows/:name/source` — returns `{ name, version, sourceCode, readOnly, updatedAt }`, with a `readOnly: true` degradation for workflows deployed before source capture.
  - SDK: `Workflows.deploy()` accepts `expectedVersion` and `dryRun` and throws a typed `VersionConflictError` on 409. `Workflows.getSource(name)` fetches the stored source. Every SDK request sends `x-sl-origin` (default `cli`, overridable via `new SecondLayer({ origin })`). `ApiError` now preserves the parsed response body.
  - MCP: new `workflows_deploy` tool (bundles via `@secondlayer/bundler`, sets `x-sl-origin: mcp`, surfaces bundler errors verbatim, supports `expectedVersion` + `dryRun`), `workflows_get_definition` (returns stored TypeScript source), and `workflows_delete`.

- [`fbc8c95`](https://github.com/ryanwaits/secondlayer/commit/fbc8c9555d2978b7178e33e322330806920de91a) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Read / edit / diff loop for workflows:

  - Web: new session tools `read_workflow` (fetches stored source + version via `/api/workflows/:name/source`, graceful read-only fallback) and `edit_workflow` (HIL with diff card). A new `DiffCard` component renders server-rendered unified diff hunks; a companion `POST /api/sessions/diff-workflow` route pre-computes hunks via the `diff` package and shiki. Confirming the edit reuses the Sprint 3 bundle + deploy path with `expectedVersion`, surfaces 409s as "Stale vX.Y.Z" on the card, and the session instructions now enforce read → edit → confirm with the in-flight-run caveat.
  - API: `POST /api/workflows` now deletes any lingering `workflow_schedules` row when a workflow edit moves the trigger off `schedule`, so the cron worker stops firing the old schedule.
  - MCP: new `workflows_propose_edit` tool — fetches the deployed source, bundles the proposed source for validation only (no deploy), and returns `{ currentVersion, currentSource, proposedSource, diffText, bundleValid, validation, bundleSize }` so external agents can present a diff without committing.

- [`eaa6115`](https://github.com/ryanwaits/secondlayer/commit/eaa61153f4a4247c42b132e022b5e972d2498883) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - Introduce `@secondlayer/scaffold`: single home for browser-safe code generation. Hosts the existing `generateSubgraphCode` (moved out of MCP, deduped from `apps/web`) plus a new `generateWorkflowCode` that emits compilable `defineWorkflow()` source from a typed intent (event/stream/schedule/manual trigger, ordered steps, optional delivery target).

  - `@secondlayer/workflows/templates`: six seed templates (`whale-alert`, `mint-watcher`, `price-circuit-breaker`, `daily-digest`, `failed-tx-alert`, `health-cron`), each a compilable source string with `id`, `name`, `description`, `category`, `trigger`, and `prompt`. Helpers `getTemplateById` and `getTemplatesByCategory` mirror the subgraph templates API.
  - MCP: new `workflows_scaffold` (typed codegen), `workflows_template_list`, and `workflows_template_get` tools. The `secondlayer://templates` resource now returns both subgraph and workflow templates tagged with a `kind` discriminator.

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
- Updated dependencies [[`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5), [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9), [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7), [`d332f9c`](https://github.com/ryanwaits/secondlayer/commit/d332f9cb75638ff828ead721ce0e229100fd0e77), [`38e62e7`](https://github.com/ryanwaits/secondlayer/commit/38e62e74e600c353884fc89a5e22b8840a4d2689), [`eaa6115`](https://github.com/ryanwaits/secondlayer/commit/eaa61153f4a4247c42b132e022b5e972d2498883), [`e9c298c`](https://github.com/ryanwaits/secondlayer/commit/e9c298c828770e8ff538b957a7d7f38a7753900f), [`db333b1`](https://github.com/ryanwaits/secondlayer/commit/db333b1ea707516462f034ef13d37e5ff5fa01de)]:
  - @secondlayer/sdk@1.0.0
  - @secondlayer/scaffold@1.0.0
  - @secondlayer/workflows@1.0.0
  - @secondlayer/subgraphs@0.11.6
  - @secondlayer/bundler@0.2.0

## 0.4.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@0.11.0
  - @secondlayer/sdk@0.10.2
  - @secondlayer/workflows@0.0.3

## 0.4.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@0.10.0
  - @secondlayer/sdk@0.10.1
  - @secondlayer/workflows@0.0.2

## 0.4.0

### Minor Changes

- feat: add workflows support across packages

  - @secondlayer/sdk: add workflows client
  - @secondlayer/cli: add `sl workflows` commands
  - @secondlayer/mcp: add workflow tools for AI agents
  - @secondlayer/indexer: add tx repair script for missing function_args and raw_result

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.10.0

## 0.3.5

### Patch Changes

- 885662d: feat(subgraphs): named-object sources with SubgraphFilter discriminated union

  Breaking: sources changed from `SubgraphSource[]` to `Record<string, SubgraphFilter>`. Handler keys are now source names, not derived sourceKey strings. Event data auto-unwrapped via cvToValue. New context methods: patch, patchOrInsert, formatUnits, aggregates.

- Updated dependencies [885662d]
  - @secondlayer/subgraphs@0.9.0
  - @secondlayer/sdk@0.9.1

## 0.3.4

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@0.8.0
  - @secondlayer/sdk@0.9.0

## 0.3.3

### Patch Changes

- Updated dependencies [[`e4a6258`](https://github.com/ryanwaits/secondlayer/commit/e4a625854bea486efd62f9ebdf47a0791a850757)]:
  - @secondlayer/subgraphs@0.7.0
  - @secondlayer/sdk@0.8.0

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/sdk@0.7.0
  - @secondlayer/subgraphs@0.6.0

## 0.3.1

### Patch Changes

- Migrate all zod imports from v3 compat layer to zod/v4 and fix type errors.

- Updated dependencies []:
  - @secondlayer/subgraphs@0.5.5

## 0.3.0

### Minor Changes

- Add structured error handling, 3 new tools (replay, rotate_secret, whoami), enhanced subgraphs_query, and 3 MCP resources.

## 0.2.1

### Patch Changes

- Fix npx resolution, version mismatch, and include README in published package.

## 0.2.0

### Minor Changes

- Initial release. 19 MCP tools: streams CRUD, subgraph deploy/query, scaffold, templates. Stdio and HTTP transports.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@0.5.4
