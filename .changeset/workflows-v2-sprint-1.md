---
"@secondlayer/workflows": minor
"@secondlayer/bundler": patch
"@secondlayer/shared": minor
---

Workflows v2 — Sprint 1: AI SDK v6 substrate + sub-step memoization.

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
