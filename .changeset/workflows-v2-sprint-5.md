---
"@secondlayer/workflows": minor
"@secondlayer/shared": minor
"@secondlayer/stacks": minor
---

Workflows v2 — Sprint 5: budgets, awaitConfirmation, error-aware retries.

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
