# @secondlayer/scaffold

## 1.2.0

### Minor Changes

- 5cc0823: Make generated contract-state readers point at your own node, configurably. Each generated map/var/constant reader now accepts `{ apiUrl }` and honors `STACKS_NODE_RPC_URL`, with precedence `apiUrl > STACKS_NODE_RPC_URL > network default` (the public API default is kept for zero-config use). Repoint the CLI's mainnet/testnet ABI fetch off the platform-dead `/api/node` proxy to the SecondLayer contract registry (`/v1/contracts/:id?include=abi`), which works in prod.

## 1.1.0

### Minor Changes

- 8866c4e: Add `generate_contract_interface` — generate a typed TypeScript contract client (typed methods + map/var/constant readers) from a deployed contract's ABI (fetched from the registry). The interface generator and its shared Clarity codegen utils (clarity-conversion, type-mapping, generator-helpers) now live in `@secondlayer/scaffold` and are consumed by both the CLI (`sl generate`, via re-export shims — no behavior change) and the new MCP tool, single-sourcing the logic.
- ac68f8d: Add `scaffold_from_trait` — generate a deploy-ready subgraph that indexes every contract conforming to a SIP trait (sip-009 → nft_transfer source, sip-010/sip-013 → ft_transfer), no specific contract needed. The trait-scoped generator now lives in `@secondlayer/scaffold` as `generateTraitSubgraph`, single-sourced so the CLI `sl subgraphs scaffold --trait` and the MCP `scaffold_from_trait` tool emit identical output.

## 1.0.7

### Patch Changes

- aa9fe86: Add a package README for the npm listing.

## 1.0.6

### Patch Changes

- 229c297: Add license, repository, and homepage metadata plus a bundled LICENSE file; drop src from clarity-docs npm files.
- Updated dependencies:
  - @secondlayer/subgraphs@3.2.1

## 1.0.5

### Patch Changes

- Updated dependencies:
  - @secondlayer/subgraphs@3.0.0

## 1.0.4

### Patch Changes

- Updated dependencies:
  - @secondlayer/subgraphs@2.0.0

## 1.0.3

### Patch Changes

- Updated dependencies:
  - @secondlayer/subgraphs@1.3.3

## 1.0.2

### Patch Changes

- Remove workflow residuals from scaffold output; add regression test.

- Updated dependencies []:
  - @secondlayer/subgraphs@1.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [[`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`d16a3dd`](https://github.com/ryanwaits/secondlayer/commit/d16a3dd64e12d9c683ca4c5dcbb2c44837bdd5c6), [`1fe6d2b`](https://github.com/ryanwaits/secondlayer/commit/1fe6d2b168dba2e634bf87b69f155f25ad94a127), [`e7d93b3`](https://github.com/ryanwaits/secondlayer/commit/e7d93b3e054cd9e2656dfa1202c90b08ac5e7fa8)]:
  - @secondlayer/subgraphs@1.0.0

## 1.0.1-alpha.0

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@1.0.0-alpha.0

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

- [`eaa6115`](https://github.com/ryanwaits/secondlayer/commit/eaa61153f4a4247c42b132e022b5e972d2498883) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - Introduce `@secondlayer/scaffold`: single home for browser-safe code generation. Hosts the existing `generateSubgraphCode` (moved out of MCP, deduped from `apps/web`) plus a new `generateWorkflowCode` that emits compilable `defineWorkflow()` source from a typed intent (event/stream/schedule/manual trigger, ordered steps, optional delivery target).
  - `@secondlayer/workflows/templates`: six seed templates (`whale-alert`, `mint-watcher`, `price-circuit-breaker`, `daily-digest`, `failed-tx-alert`, `health-cron`), each a compilable source string with `id`, `name`, `description`, `category`, `trigger`, and `prompt`. Helpers `getTemplateById` and `getTemplatesByCategory` mirror the subgraph templates API.
  - MCP: new `workflows_scaffold` (typed codegen), `workflows_template_list`, and `workflows_template_get` tools. The `secondlayer://templates` resource now returns both subgraph and workflow templates tagged with a `kind` discriminator.

### Patch Changes

- Updated dependencies [[`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5), [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9), [`eaa6115`](https://github.com/ryanwaits/secondlayer/commit/eaa61153f4a4247c42b132e022b5e972d2498883)]:
  - @secondlayer/workflows@1.0.0
  - @secondlayer/subgraphs@0.11.6
