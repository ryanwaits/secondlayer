# @secondlayer/bundler

## 0.3.2

### Patch Changes

- [`4462afd`](https://github.com/ryanwaits/secondlayer/commit/4462afded306504a9cac1bf4559333bf3d79e6d8) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Stabilize subgraph deploys by importing generated handlers through file URLs,
  evaluating bundled subgraphs from temporary modules instead of data URIs, and
  adding a CLI deploy dry-run preview. ABI scaffolding now reports the actual
  Secondlayer node source and fails quickly when contract fetches are unavailable.
- Updated dependencies [[`4462afd`](https://github.com/ryanwaits/secondlayer/commit/4462afded306504a9cac1bf4559333bf3d79e6d8)]:
  - @secondlayer/subgraphs@1.2.1

## 0.3.1

### Patch Changes

- Updated dependencies [[`281ab8c`](https://github.com/ryanwaits/secondlayer/commit/281ab8c05b88255b22d5f5e2585ce3cd88f77ff3), [`d16a3dd`](https://github.com/ryanwaits/secondlayer/commit/d16a3dd64e12d9c683ca4c5dcbb2c44837bdd5c6), [`1fe6d2b`](https://github.com/ryanwaits/secondlayer/commit/1fe6d2b168dba2e634bf87b69f155f25ad94a127), [`e7d93b3`](https://github.com/ryanwaits/secondlayer/commit/e7d93b3e054cd9e2656dfa1202c90b08ac5e7fa8)]:
  - @secondlayer/subgraphs@1.0.0

## 0.3.1-alpha.0

### Patch Changes

- Updated dependencies []:
  - @secondlayer/subgraphs@1.0.0-alpha.0

## 0.3.0

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

- [`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Workflows v2 — Sprint 2.5: fix `util is not defined` when bundling `step.render` workflows.

  **Root cause:** `zod` and `zod/v4` resolve to different physical files in `node_modules`. A user workflow that imports `z` from `zod` alongside internal schemas importing from `zod/v4` produced two Zod copies in the bundled handler; esbuild left the first copy's `util` identifier unscoped.

  **Fix:**

  - All Stacks atom schemas now import `z` from `zod` (matching the user's natural `import { z } from "zod"`) so the bundler sees one module.
  - New `@secondlayer/stacks/ui/schemas` subpath — React-free Zod schemas + a pass-through `defineCatalog` helper. Workflow authors import from `/ui/schemas`; only the dashboard imports `/ui` (which pulls React + `@json-render/react`).
  - `step.render` now accepts either a raw `RawCatalogDefinition` (`{ components, actions? }`) or a pre-built `@json-render/core` `Catalog`. The runner wraps raw definitions into a real `Catalog` at render time via its own `@json-render/*` install — keeping json-render entirely out of the user bundle.

  **New bundler regression test:** `bundleWorkflowCode` now covers a workflow that imports `defineCatalog` + atom schemas from `@secondlayer/stacks/ui/schemas` and asserts it bundles + evaluates cleanly.

  **Runtime dep bump:** `@secondlayer/workflow-runner` moves `@json-render/core` + `@json-render/react` from devDependencies to dependencies so raw catalog definitions can be hydrated.

- [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1) Thanks [@ryanwaits](https://github.com/ryanwaits)! - Workflows v2 — Sprint 3: Stacks SDK pillar (tools, triggers, tx builders).

  **New subpaths on `@secondlayer/stacks`:**

  - **`/tools`** — 12 AI-SDK-compatible read tools: `getStxBalance`, `getAccountInfo`, `getBlock`, `getBlockHeight`, `readContract`, `estimateFee`, `bnsResolve`, `bnsReverse`, plus Hiro-extended reads `getTransaction`, `getAccountHistory`, `getMempoolStats`, `getNftHoldings`. Each is a `tool()` from `ai@^6` with a Zod input schema and typed execute. Both bare exports (zero-config, uses `STACKS_RPC_URL` / `STACKS_CHAIN` env) and a `createStacksTools(client)` factory for custom clients.

  - **`/tools/btc`** — 5 Bitcoin read tools via mempool.space: `btcConfirmations`, `btcBalance`, `btcUtxos`, `btcFeeEstimate`, `btcBlockHeight`. Override the endpoint with `BTC_MEMPOOL_URL`.

  - **`/triggers`** — typed `on.*` helpers for all 13 `SubgraphFilter` variants (`stxTransfer`, `stxMint`, `stxBurn`, `stxLock`, `ftTransfer`, `ftMint`, `ftBurn`, `nftTransfer`, `nftMint`, `nftBurn`, `contractCall`, `contractDeploy`, `printEvent`). Each returns a `TypedEventTrigger<TEvent>` whose phantom `__event` marker drives handler-event inference in `defineWorkflow`.

  - **`/tx`** — `tx.transfer`, `tx.contractCall`, `tx.deploy`, `tx.multisend`. Factory functions returning `TxIntent` objects — unsigned descriptions of what to broadcast. The `broadcast()` primitive (Sprint 4) consumes these, resolves fee/nonce/signer, and submits.

  **`defineWorkflow` now infers handler event type** from the trigger's phantom `__event` marker. A workflow triggered by `on.stxTransfer(…)` sees `event: StxTransferEvent` (with typed `sender`, `recipient`, `amount`, `tx`) in the handler — no casting needed. Untyped triggers (`{ type: "schedule" }`, raw filter literals) continue to see `Record<string, unknown>` as before.

  **Bundler regression coverage:** new test exercises a workflow that imports from `/triggers` + `/tx` + uses the narrowed handler event. Proves the Sprint 2.5 util-bug fix holds across the Sprint 3 surface.

- Updated dependencies [[`4f1c7ea`](https://github.com/ryanwaits/secondlayer/commit/4f1c7eaa9242295972404174b24049c54d6b7a50), [`e88b5ce`](https://github.com/ryanwaits/secondlayer/commit/e88b5cedd6385ce26884b4f7f0d68ed917686955), [`7e1cf3d`](https://github.com/ryanwaits/secondlayer/commit/7e1cf3d4048b310c036ae30dac0d76f06d712375), [`48aea1e`](https://github.com/ryanwaits/secondlayer/commit/48aea1eebe01b09e89d4f600b8e22c5709a32ef1), [`7922498`](https://github.com/ryanwaits/secondlayer/commit/79224983a68e5eb44a2213a39f806eba227d37e3), [`9d5f68b`](https://github.com/ryanwaits/secondlayer/commit/9d5f68b46f334e4984bd1bea21d9de6de335cf01)]:
  - @secondlayer/workflows@1.1.0
  - @secondlayer/subgraphs@0.11.7

## 0.2.0

### Minor Changes

- [`f1b6725`](https://github.com/ryanwaits/secondlayer/commit/f1b67257d9d6eae413ea1f49c779522205a68fc7) Thanks [@ryanwaits](https://github.com/ryanwaits)! - - Introduce `@secondlayer/bundler`: shared esbuild + validate helpers (`bundleSubgraphCode`, `bundleWorkflowCode`) with typed `BundleSizeError` and per-kind caps (subgraphs 4 MB, workflows 1 MB). MCP and CLI now consume it instead of inlining esbuild.
  - Persist workflow TypeScript source alongside the compiled handler (`workflow_definitions.source_code`, migration `0030`). `upsertWorkflowDefinition` bumps the patch version on every update and throws `VersionConflictError` when `expectedVersion` does not match the stored row.
  - Extend `DeployWorkflowRequestSchema` and the SDK/CLI deploy path with `sourceCode` + `expectedVersion`, so `sl workflows deploy` populates the new column and surfaces conflict detection.

### Patch Changes

- Updated dependencies [[`2d61e78`](https://github.com/ryanwaits/secondlayer/commit/2d61e7822ee2b1dee28bdbccf92f1837c0fd05e5), [`b4a4bf1`](https://github.com/ryanwaits/secondlayer/commit/b4a4bf186d59edb29fbde7ffd8d8273d6390c7e9), [`eaa6115`](https://github.com/ryanwaits/secondlayer/commit/eaa61153f4a4247c42b132e022b5e972d2498883)]:
  - @secondlayer/workflows@1.0.0
  - @secondlayer/subgraphs@0.11.6
