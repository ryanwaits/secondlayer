---
"@secondlayer/scaffold": minor
"@secondlayer/workflows": minor
"@secondlayer/mcp": minor
"@secondlayer/web": patch
---

- Introduce `@secondlayer/scaffold`: single home for browser-safe code generation. Hosts the existing `generateSubgraphCode` (moved out of MCP, deduped from `apps/web`) plus a new `generateWorkflowCode` that emits compilable `defineWorkflow()` source from a typed intent (event/stream/schedule/manual trigger, ordered steps, optional delivery target).
- `@secondlayer/workflows/templates`: six seed templates (`whale-alert`, `mint-watcher`, `price-circuit-breaker`, `daily-digest`, `failed-tx-alert`, `health-cron`), each a compilable source string with `id`, `name`, `description`, `category`, `trigger`, and `prompt`. Helpers `getTemplateById` and `getTemplatesByCategory` mirror the subgraph templates API.
- MCP: new `workflows_scaffold` (typed codegen), `workflows_template_list`, and `workflows_template_get` tools. The `secondlayer://templates` resource now returns both subgraph and workflow templates tagged with a `kind` discriminator.
