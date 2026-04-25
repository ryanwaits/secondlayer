# @secondlayer/stacks

## 2.0.0

### Major Changes

- Move typed trigger helpers from `@secondlayer/stacks/triggers` to `@secondlayer/subgraphs/triggers`.

  `@secondlayer/stacks` no longer exports `./triggers` and no longer depends on `@secondlayer/subgraphs`.

## 1.0.1

### Patch Changes

- Doc prose cleanup (multisig "flows") and triggers index nit.

- Updated dependencies []:
  - @secondlayer/subgraphs@1.1.0

## 1.0.0

### Major Changes

- [`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Inline `EventTrigger`; drop `@secondlayer/workflows` dependency. Declaring stable (1.0) alongside the product pivot — stacks is the agent-native chain SDK going forward.

- [`8f2d720`](https://github.com/ryanwaits/secondlayer/commit/8f2d72038c28aca7bd91efb4b0c93f72bac469d3) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Strip all workflow-runner-only code.

  - Removed `broadcast()`, `broadcastContext`, `BroadcastOptions/Result/Runtime` — was tied to the AsyncLocalStorage-bound workflow runner that no longer exists.
  - Removed `TxRejectedError`, `TxTimeoutError`, `TxSignerRefusedError`, `TxRejectionReason` — broadcast-only error classes.
  - Removed `tx.transfer/contractCall/deploy/multiSend` intent builders + `TxIntent` types — intent shapes for workflow handlers.
  - Removed `/ui` subpath + all json-render atoms (`address`, `amount`, `blockHeight`, `bnsName`, `nftAsset`, `principal`, `token`, `txStatus`, `defineCatalog`, `atomComponentMap`) — was for `step.render()` only.
  - Removed `/ui/schemas` subpath + its Zod schema exports.
  - Dropped React + @json-render peer deps (no longer needed).

  For transaction broadcasts from receiver code, use `buildTokenTransfer`, `buildContractCall`, `buildContractDeploy` from `@secondlayer/stacks/transactions` — standalone, no runtime context required.

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

### Patch Changes

- Updated dependencies [[`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`d16a3dd`](https://github.com/ryanwaits/secondlayer/commit/d16a3dd64e12d9c683ca4c5dcbb2c44837bdd5c6), [`1fe6d2b`](https://github.com/ryanwaits/secondlayer/commit/1fe6d2b168dba2e634bf87b69f155f25ad94a127), [`e7d93b3`](https://github.com/ryanwaits/secondlayer/commit/e7d93b3e054cd9e2656dfa1202c90b08ac5e7fa8)]:
  - @secondlayer/subgraphs@1.0.0

## 1.0.0-beta.1

### Major Changes

- Strip all workflow-runner-only code.

  - Removed `broadcast()`, `broadcastContext`, `BroadcastOptions/Result/Runtime` — was tied to the AsyncLocalStorage-bound workflow runner that no longer exists.
  - Removed `TxRejectedError`, `TxTimeoutError`, `TxSignerRefusedError`, `TxRejectionReason` — broadcast-only error classes.
  - Removed `tx.transfer/contractCall/deploy/multiSend` intent builders + `TxIntent` types — intent shapes for workflow handlers.
  - Removed `/ui` subpath + all json-render atoms (`address`, `amount`, `blockHeight`, `bnsName`, `nftAsset`, `principal`, `token`, `txStatus`, `defineCatalog`, `atomComponentMap`) — was for `step.render()` only.
  - Removed `/ui/schemas` subpath + its Zod schema exports.
  - Dropped React + @json-render peer deps (no longer needed).

  For transaction broadcasts from receiver code, use `buildTokenTransfer`, `buildContractCall`, `buildContractDeploy` from `@secondlayer/stacks/transactions` — standalone, no runtime context required.

## 1.0.0-alpha.0

### Major Changes

- Inline `EventTrigger`; drop `@secondlayer/workflows` dependency. Declaring stable (1.0) alongside the product pivot — stacks is the agent-native chain SDK going forward.

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@1.0.0-alpha.0

## 0.3.0

### Minor Changes

- [`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Workflows v2 — Sprint 2.5: fix `util is not defined` when bundling `step.render` workflows.

  **Root cause:** `zod` and `zod/v4` resolve to different physical files in `node_modules`. A user workflow that imports `z` from `zod` alongside internal schemas importing from `zod/v4` produced two Zod copies in the bundled handler; esbuild left the first copy's `util` identifier unscoped.

  **Fix:**

  - All Stacks atom schemas now import `z` from `zod` (matching the user's natural `import { z } from "zod"`) so the bundler sees one module.
  - New `@secondlayer/stacks/ui/schemas` subpath — React-free Zod schemas + a pass-through `defineCatalog` helper. Workflow authors import from `/ui/schemas`; only the dashboard imports `/ui` (which pulls React + `@json-render/react`).
  - `step.render` now accepts either a raw `RawCatalogDefinition` (`{ components, actions? }`) or a pre-built `@json-render/core` `Catalog`. The runner wraps raw definitions into a real `Catalog` at render time via its own `@json-render/*` install — keeping json-render entirely out of the user bundle.

  **New bundler regression test:** `bundleWorkflowCode` now covers a workflow that imports `defineCatalog` + atom schemas from `@secondlayer/stacks/ui/schemas` and asserts it bundles + evaluates cleanly.

  **Runtime dep bump:** `@secondlayer/workflow-runner` moves `@json-render/core` + `@json-render/react` from devDependencies to dependencies so raw catalog definitions can be hydrated.

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

- [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Workflows v2 — Sprint 3: Stacks SDK pillar (tools, triggers, tx builders).

  **New subpaths on `@secondlayer/stacks`:**

  - **`/tools`** — 12 AI-SDK-compatible read tools: `getStxBalance`, `getAccountInfo`, `getBlock`, `getBlockHeight`, `readContract`, `estimateFee`, `bnsResolve`, `bnsReverse`, plus Hiro-extended reads `getTransaction`, `getAccountHistory`, `getMempoolStats`, `getNftHoldings`. Each is a `tool()` from `ai@^6` with a Zod input schema and typed execute. Both bare exports (zero-config, uses `STACKS_RPC_URL` / `STACKS_CHAIN` env) and a `createStacksTools(client)` factory for custom clients.

  - **`/tools/btc`** — 5 Bitcoin read tools via mempool.space: `btcConfirmations`, `btcBalance`, `btcUtxos`, `btcFeeEstimate`, `btcBlockHeight`. Override the endpoint with `BTC_MEMPOOL_URL`.

  - **`/triggers`** — typed `on.*` helpers for all 13 `SubgraphFilter` variants (`stxTransfer`, `stxMint`, `stxBurn`, `stxLock`, `ftTransfer`, `ftMint`, `ftBurn`, `nftTransfer`, `nftMint`, `nftBurn`, `contractCall`, `contractDeploy`, `printEvent`). Each returns a `TypedEventTrigger<TEvent>` whose phantom `__event` marker drives handler-event inference in `defineWorkflow`.

  - **`/tx`** — `tx.transfer`, `tx.contractCall`, `tx.deploy`, `tx.multisend`. Factory functions returning `TxIntent` objects — unsigned descriptions of what to broadcast. The `broadcast()` primitive (Sprint 4) consumes these, resolves fee/nonce/signer, and submits.

  **`defineWorkflow` now infers handler event type** from the trigger's phantom `__event` marker. A workflow triggered by `on.stxTransfer(…)` sees `event: StxTransferEvent` (with typed `sender`, `recipient`, `amount`, `tx`) in the handler — no casting needed. Untyped triggers (`{ type: "schedule" }`, raw filter literals) continue to see `Record<string, unknown>` as before.

  **Bundler regression coverage:** new test exercises a workflow that imports from `/triggers` + `/tx` + uses the narrowed handler event. Proves the Sprint 2.5 util-bug fix holds across the Sprint 3 surface.

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

- [`696124e`](https://github.com/ryanwaits/secondlayer/commit/696124e115dc64d88eede394bbf422eb9a514849) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Workflows v2 — Sprint 6 polish + release readiness.

  **Fee estimation (runner):** `broadcast()` now drives the default fee off the Stacks node's `/v2/fees/transaction` estimate when `maxFee` isn't supplied. Uses the "medium" tier; falls back to the 10k µSTX default if the estimate endpoint fails. Workflow authors who pass `maxFee` retain the hard ceiling; authors who omit it get realistic fees automatically.

  **Docs:** `/workflows` marketing page gets small Broadcast + Budgets sections with end-to-end examples. `awaitConfirmation: true` documented inline in the broadcast example. Replaces the earlier "Coming soon" placeholder. Kept terse and code-heavy — no sprawl.

  **Deferred to a v2.1 polish:**

  - Dashboard burn-down UI for budgets — counters are tracked + enforced today; dashboard visibility is cosmetic (CLI and API can surface the same data)
  - In-dashboard secret rotation UI — CLI (`sl secrets rotate`) remains the primary path

  This sprint is the final v2 commit before publishing. Migrations `0033` – `0036` all outstanding; `SECONDLAYER_SECRETS_KEY` required in Hetzner env (already set per 2026-04-17).

- Updated dependencies [[`4f1c7ea`](https://github.com/ryanwaits/secondlayer/commit/4f1c7eaa9242295972404174b24049c54d6b7a50), [`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955), [`7e1cf3d`](https://github.com/ryanwaits/secondlayer/commit/7e1cf3d4048b310c036ae30dac0d76f06d712375), [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1), [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3), [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01)]:
  - @secondlayer/workflows@1.1.0
  - @secondlayer/subgraphs@0.11.7

## 0.2.2

### Patch Changes

- Fix SIP-005 wire format: post condition field order, TokenTransfer memo encoding, buffer underflow guards, add missing TenureChangeCause/ClarityVersion variants.

## 0.2.1

### Patch Changes

- Fix duplicate export of `combineMultiSigSignatures` caused by dynamic import creating a separate bunup chunk. Replaced with static import.

## 0.2.0

### Minor Changes

- Convert contract method names from kebab-case to camelCase for better TypeScript ergonomics (e.g. `contract.read.getBalance()` instead of `contract.read["get-balance"]()`). Clean up unused imports and fix test types.

## 0.1.0

### Minor Changes

- a070de2: Support all 9 Stacks transaction payload types in deserializer/serializer. Fixes "Unknown payload type: 4" error during genesis sync by adding Coinbase, CoinbaseToAltRecipient, PoisonMicroblock, TenureChange, and NakamotoCoinbase.

## 0.0.4

### Patch Changes

- Fix `.extend()` chaining losing previous extensions. Calling `.extend(pox()).extend(bns())` now correctly preserves all extensions.

## 0.0.3

### Patch Changes

- Return `null` instead of throwing when BNS names don't exist. Fixes `resolveName`, `getPrimaryName`, and `getNameId` to catch `ContractResponseError` for not-found cases.

## 0.0.2

### Patch Changes

- Fix extension type inference in built .d.ts files. `bns()`, `pox()`, and `stackingDao()` now emit full method types instead of `{}` after `.extend()`.
