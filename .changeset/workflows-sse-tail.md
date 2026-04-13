---
"@secondlayer/api": minor
"@secondlayer/sdk": minor
"@secondlayer/mcp": minor
"@secondlayer/web": minor
---

Live-tail workflow runs over SSE:

- API: new `GET /api/workflows/:name/runs/:runId/stream` Hono `streamSSE` route. Emits an initial snapshot of `workflow_steps`, polls every 500ms for status diffs, pushes `step`, `heartbeat`, `done`, and `timeout` events, and caps at 30 minutes (matches `logs.ts`).
- SDK: typed `workflows.streamRun(name, runId, onEvent, signal)` plus shared `WorkflowStepEvent` / `WorkflowTailEvent` types. Uses the native `fetch` streaming response so callers can carry `x-sl-origin` headers alongside Bearer auth.
- MCP: new `workflows_tail_run` tool that wraps `streamRun` and returns a compacted log of up to `limit` events or until the run completes / `timeoutMs` elapses — MCP is not streaming-first, so this is a bounded collect-and-return.
- Web: new `tail_workflow_run` session tool that emits `{ name, runId }` and a client-side `StepFlowLive` component that opens an SSE proxy route (`/api/sessions/tail-workflow-run/[name]/[runId]`) and animates the `StepFlow` timeline as events arrive. The deploy-success card's **Tail live runs** CTA is now wired — it triggers a run if the user hasn't already, then mounts the live timeline in-card.
