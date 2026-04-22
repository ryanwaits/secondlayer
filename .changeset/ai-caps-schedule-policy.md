---
"@secondlayer/shared": minor
"@secondlayer/workflows": minor
---

Scaffold AI cap enforcement + schedule cadence policy for the future workflow-runner revival. Runner is currently dead (see migration 0038) so none of this is wired to runtime yet, but it gives the P1 authoring-loop work a stable surface to hook into day one.

- Migration 0051 adds `workflow_ai_usage_daily` — PK `(tenant_id, day)`, tracks `evals` count + `cost_usd_cents` per tenant per UTC day.
- New `getAiCapForPlan(plan)` helper in `@secondlayer/shared/pricing` returns tier limits: Hobby 50/day, Launch 500, Grow 1000, Scale 2500, Enterprise unlimited. Unknown plans fall through to Hobby so a stray DB value can't accidentally grant more AI.
- New `@secondlayer/shared/db/queries/workflow-ai-usage` module: `bumpAiUsage(tenantId, cents)` (atomic upsert), `getAiUsageToday`, and `checkAiCapAvailable(tenantId, plan)` for the runner to gate each AI step.
- New `AiCapReachedError` + `AI_CAP_REACHED` code. Not in `CODE_TO_STATUS` because it's a runner-side failure, not an HTTP response — bubbles to Slack/dashboard through the workflow run record.
- New `@secondlayer/workflows/schedule-policy` with pure `validateWorkflowSchedule(plan, cronExpr)` + `minCronIntervalSeconds(expr)`. Hobby floor of 5 minutes — sub-5-min crons rejected at deploy time. Tests cover `*`, `*/5`, `0,30`, single-minute and nonsense inputs.
