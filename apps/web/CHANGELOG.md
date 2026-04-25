# @secondlayer/web

## 0.1.5

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@2.0.0

## 0.1.4

### Patch Changes

- Updated dependencies []:
  - @secondlayer/scaffold@1.0.2
  - @secondlayer/stacks@1.0.1

## 0.1.3

### Patch Changes

- Updated dependencies [[`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`8f2d720`](https://github.com/ryanwaits/secondlayer/commit/8f2d72038c28aca7bd91efb4b0c93f72bac469d3)]:
  - @secondlayer/stacks@1.0.0
  - @secondlayer/scaffold@1.0.1

## 0.1.3-beta.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@1.0.0-beta.1

## 0.1.3-alpha.0

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@1.0.0-alpha.0
  - @secondlayer/scaffold@1.0.1-alpha.0

## 0.1.2

### Patch Changes

- [`4f1c7ea`](https://github.com/ryanwaits/secondlayer/commit/4f1c7eaa9242295972404174b24049c54d6b7a50) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Align `ai`/`@ai-sdk/anthropic` versions with workflows v2 (`ai@6.0.167`, `@ai-sdk/anthropic@3.0.71`). Root `overrides` entry in the monorepo `package.json` forces a single version across workspaces to avoid duplicated `@ai-sdk/provider-utils` copies.

- [`7e1cf3d`](https://github.com/ryanwaits/secondlayer/commit/7e1cf3d4048b310c036ae30dac0d76f06d712375) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Workflows v2 — Sprint 2: json-render integration + Stacks UI atoms.

  **New step primitive:**

  - `step.render(id, catalog, { model, prompt, system?, context? })` — AI generates a json-render catalog-validated spec. Runner derives a Zod schema from `catalog.zodSchema()`, passes it to AI SDK `generateObject`, validates the result with `catalog.validate()`, and returns `{ spec, usage }`.

  **Stacks UI pillar (`@secondlayer/stacks/ui`):**

  - 8 atom components: `Address`, `Amount`, `TxStatus`, `Principal`, `BnsName`, `NftAsset`, `BlockHeight`, `Token`
  - Each atom exports `{ props: ZodType, render: React.FC }` for use in both json-render catalogs and direct React rendering
  - `defineCatalog` + `schema` re-exported from `@json-render/*` so authors only import from one place
  - `atoms` registry + `atomComponentMap` helper for `createRenderer()` dashboard wiring

  **Dashboard:**

  - Workflow run detail (`apps/web/src/app/platform/workflows/[name]/runs/[runId]/page.tsx`) now dispatches on `stepType === "render"` — uses `<WorkflowRenderOutput>` client component (json-render `createRenderer` with Stacks atoms) instead of raw JSON `<pre>`. Unknown component types fall through to the raw output.
  - New step type colors: `render`, `generateObject`, `generateText`, `tool`.

  **Package plumbing:**

  - `@secondlayer/stacks` adopts JSX (`tsconfig.json: "jsx": "react-jsx"`) and exposes a new `./ui` bunup entry + package subpath export
  - `@json-render/core` + `@json-render/react` added as optional peer dependencies of both `@secondlayer/stacks` and `@secondlayer/workflows`

  **Known limitation (deferred to a later sprint):** bundling a user workflow that imports `@secondlayer/stacks/ui` directly can produce duplicate Zod copies whose second pass references a bare `util` identifier esbuild doesn't re-scope, causing `Module evaluation failed: util is not defined` at deploy-time. Workaround: keep catalog definitions outside the bundled handler (inline Zod schemas only) until the bundler is taught to dedupe the nested copies or json-render publishes an unbundled entry.

- [`696124e`](https://github.com/ryanwaits/secondlayer/commit/696124e115dc64d88eede394bbf422eb9a514849) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Workflows v2 — Sprint 6 polish + release readiness.

  **Fee estimation (runner):** `broadcast()` now drives the default fee off the Stacks node's `/v2/fees/transaction` estimate when `maxFee` isn't supplied. Uses the "medium" tier; falls back to the 10k µSTX default if the estimate endpoint fails. Workflow authors who pass `maxFee` retain the hard ceiling; authors who omit it get realistic fees automatically.

  **Docs:** `/workflows` marketing page gets small Broadcast + Budgets sections with end-to-end examples. `awaitConfirmation: true` documented inline in the broadcast example. Replaces the earlier "Coming soon" placeholder. Kept terse and code-heavy — no sprawl.

  **Deferred to a v2.1 polish:**

  - Dashboard burn-down UI for budgets — counters are tracked + enforced today; dashboard visibility is cosmetic (CLI and API can surface the same data)
  - In-dashboard secret rotation UI — CLI (`sl secrets rotate`) remains the primary path

  This sprint is the final v2 commit before publishing. Migrations `0033` – `0036` all outstanding; `SECONDLAYER_SECRETS_KEY` required in Hetzner env (already set per 2026-04-17).

- Updated dependencies [[`4f1c7ea`](https://github.com/ryanwaits/secondlayer/commit/4f1c7eaa9242295972404174b24049c54d6b7a50), [`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955), [`7e1cf3d`](https://github.com/ryanwaits/secondlayer/commit/7e1cf3d4048b310c036ae30dac0d76f06d712375), [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1), [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3), [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01), [`696124e`](https://github.com/ryanwaits/secondlayer/commit/696124e115dc64d88eede394bbf422eb9a514849)]:
  - @secondlayer/workflows@1.1.0
  - @secondlayer/stacks@0.3.0
  - @secondlayer/scaffold@1.0.0

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @secondlayer/workflows@1.0.1

## 0.1.0

### Minor Changes

- [`f4b1c0d`](https://github.com/ryanwaits/secondlayer/commit/f4b1c0d4f5385ca4179a08cfe78004994f1e24cb) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Subgraph chat authoring loop — web surface.

  - New session tools: `deploy_subgraph` (HIL), `read_subgraph`, `edit_subgraph` (HIL), `tail_subgraph_sync`. Agents can now scaffold → customize → deploy → read → edit → tail subgraphs end-to-end from chat, mirroring the workflows loop.
  - New proxy routes `/api/sessions/bundle-subgraph` and `/api/sessions/diff-subgraph` pass bundle + diff work through to the Hetzner API's server-side bundler.
  - Shared `buildUnifiedDiff()` helper in `lib/sessions/diff.ts` backs both the workflow and subgraph edit flows; `diff-workflow.ts` is now a thin re-export for backward compatibility.
  - New cards `DeploySubgraphCard` and `SubgraphSyncLive` (2s polling against `GET /api/subgraphs/:name` until catch-up, 10-minute ceiling).
  - `tool-part-renderer.tsx` wires the new HIL set members, input-available cards, output-available renderers, and a `bundleAndDeploySubgraph()` helper.
  - System prompt (`lib/sessions/instructions.ts`) gains Subgraph authoring and Subgraph edit loop sections — teaches the agent to pause after scaffold, always read before editing, and warn users when schema changes will trigger a reindex. Explicitly notes that subgraph edits don't yet have stale-write protection.
  - `platform/subgraphs/[name]/page.tsx` gets an "Open in chat" CTA mirroring the workflows dashboard button; a new session is seeded with a prompt asking the agent to read the subgraph's source.

- [`c3b1ef7`](https://github.com/ryanwaits/secondlayer/commit/c3b1ef78f4d9506d42df033fdec4f5e83176cf14) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Chat can now scaffold → deploy workflows end-to-end without leaving the session:

  - New session tools: `scaffold_workflow` (typed trigger + steps → compilable source), `deploy_workflow` (HIL deploy card), and `list_workflow_templates` (gallery over the six `@secondlayer/workflows/templates` seeds).
  - New `POST /api/sessions/bundle-workflow` route that session-auths and bundles via `@secondlayer/bundler`, returning typed `BundleSizeError` payloads on overflow.
  - The deploy action card bundles server-side, persists via `POST /api/workflows` with `x-sl-origin: session`, and surfaces bundler errors inline. On success it renders a follow-up card with **Trigger test run** and **Tail live runs** CTAs; the first test-run reuses the deploy click as consent and fires directly against `/api/workflows/:name/trigger` (tail wiring lands in Sprint 5).
  - Session instructions now describe the scaffold → deploy loop, list the six seed templates, and enforce the in-flight-run caveat on every confirm message.

- [`fbc8c95`](https://github.com/ryanwaits/secondlayer/commit/fbc8c9555d2978b7178e33e322330806920de91a) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Read / edit / diff loop for workflows:

  - Web: new session tools `read_workflow` (fetches stored source + version via `/api/workflows/:name/source`, graceful read-only fallback) and `edit_workflow` (HIL with diff card). A new `DiffCard` component renders server-rendered unified diff hunks; a companion `POST /api/sessions/diff-workflow` route pre-computes hunks via the `diff` package and shiki. Confirming the edit reuses the Sprint 3 bundle + deploy path with `expectedVersion`, surfaces 409s as "Stale vX.Y.Z" on the card, and the session instructions now enforce read → edit → confirm with the in-flight-run caveat.
  - API: `POST /api/workflows` now deletes any lingering `workflow_schedules` row when a workflow edit moves the trigger off `schedule`, so the cron worker stops firing the old schedule.
  - MCP: new `workflows_propose_edit` tool — fetches the deployed source, bundles the proposed source for validation only (no deploy), and returns `{ currentVersion, currentSource, proposedSource, diffText, bundleValid, validation, bundleSize }` so external agents can present a diff without committing.

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

- [`cf5e323`](https://github.com/ryanwaits/secondlayer/commit/cf5e323ebeb8e6af418660f70affe95772512b42) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Backfill the public marketing docs for everything P1 shipped:

  - `/workflows`: new sections for **Templates**, **Chat authoring**, **Versioning & rollback**, and **Live tail**. Expanded **Deploy** + **Management** code blocks to cover `sourceCode`, `expectedVersion`, `dryRun`, `clientRequestId`, `VersionConflictError`, `getSource`, `rollback`, `pauseAll`, `cancelRun`, and `streamRun`. New Props groups for the extended SDK surface, `VersionConflictError`, `WorkflowSource`, and `WorkflowTailEvent`.
  - `/sdk`: `SecondLayer` constructor now documents the `origin` option and the `x-sl-origin` header. Workflows code block shows the full deploy / source / rollback / tail surface. Error-handling section lists `VersionConflictError`, `ApiError.body`, and the new 409 / 413 status codes. Props table updated with the new methods and a dedicated **Errors** group.
  - `/cli`: Subgraphs and Workflows sections now credit `@secondlayer/bundler` (typed size caps, externalised packages) and explain that CLI deploys carry the original TypeScript source so chat edits work immediately.

- [`6f45ae5`](https://github.com/ryanwaits/secondlayer/commit/6f45ae5ebd6bc0820180750003a644d43497f5e5) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Post-P1 workflows authoring loop polish.

  - **API**: `POST /api/workflows` and `/api/workflows/bundle` now auto-resolve session-auth requests to the account's first active API key, so chat deploys no longer 401 when the caller only has a session cookie.
  - **Web**: `manage_workflows` wired as a human-in-loop tool with a structured action handler (trigger/pause/resume/delete), so the card no longer hangs after approval.
  - **Web**: live step tail now renders each completed step's output (JSON-formatted) instead of only showing errors.
  - **Web**: run ID entries in the workflow runs table are now styled as accent-colored links pointing at the existing run detail page.

- [`d332f9c`](https://github.com/ryanwaits/secondlayer/commit/d332f9cb75638ff828ead721ce0e229100fd0e77) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Move workflow bundling from Vercel to the Hetzner API.

  - **API**: new `POST /api/workflows/bundle` route that accepts a TypeScript workflow source, runs `bundleWorkflowCode` from `@secondlayer/bundler`, and returns the bundled handler + extracted metadata. Mapped via the existing `/api/workflows/*` auth + rate-limit middleware. `BundleSizeError` → `HTTP 413`, other failures → `HTTP 400`. Logs every request with `x-sl-origin` + `bundleSize` for telemetry parity with deploy logs.
  - **SDK**: new `workflows.bundle({ code })` method plus `BundleWorkflowResponse` type.
  - **Web**: `POST /api/sessions/bundle-workflow` rewritten as a thin direct-fetch passthrough to the Hetzner API. `@secondlayer/bundler` is no longer a dependency of `apps/web` and `esbuild` is no longer in `serverExternalPackages`. Vercel cold starts drop esbuild's native binary from the hot path. CLI and MCP continue to bundle locally — this only affects the chat authoring loop.

  This fixes a class of `"Module evaluation failed: Cannot find module 'unknown'"` / `NameTooLong` / `Could not resolve "@secondlayer/workflows"` failures that kept surfacing when esbuild ran inside Vercel serverless functions. Chat deploy flow now goes Vercel → Hetzner `/api/workflows/bundle` → Hetzner `/api/workflows` → workflow-runner, all against stable workspace layouts.

- [`eaa6115`](https://github.com/ryanwaits/secondlayer/commit/eaa61153f4a4247c42b132e022b5e972d2498883) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - Introduce `@secondlayer/scaffold`: single home for browser-safe code generation. Hosts the existing `generateSubgraphCode` (moved out of MCP, deduped from `apps/web`) plus a new `generateWorkflowCode` that emits compilable `defineWorkflow()` source from a typed intent (event/stream/schedule/manual trigger, ordered steps, optional delivery target).
  - `@secondlayer/workflows/templates`: six seed templates (`whale-alert`, `mint-watcher`, `price-circuit-breaker`, `daily-digest`, `failed-tx-alert`, `health-cron`), each a compilable source string with `id`, `name`, `description`, `category`, `trigger`, and `prompt`. Helpers `getTemplateById` and `getTemplatesByCategory` mirror the subgraph templates API.
  - MCP: new `workflows_scaffold` (typed codegen), `workflows_template_list`, and `workflows_template_get` tools. The `secondlayer://templates` resource now returns both subgraph and workflow templates tagged with a `kind` discriminator.
- Updated dependencies [[`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5), [`eaa6115`](https://github.com/ryanwaits/secondlayer/commit/eaa61153f4a4247c42b132e022b5e972d2498883)]:
  - @secondlayer/scaffold@1.0.0
  - @secondlayer/workflows@1.0.0

## 0.0.3

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.2.2

## 0.0.2

### Patch Changes

- Updated dependencies []:
  - @secondlayer/stacks@0.2.1
