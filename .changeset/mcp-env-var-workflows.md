---
"@secondlayer/mcp": minor
---

- Accept `SL_SERVICE_KEY` as the canonical env var name. `SECONDLAYER_API_KEY` keeps working as a deprecated alias and logs a one-time warning per process so existing integrations don't break.
- Register workflow tools on the MCP server (`workflows_list`, `workflows_get`, `workflows_trigger`, `workflows_pause`, `workflows_resume`, `workflows_runs`, and the deploy/scaffold/rollback variants). Previously defined but not wired into `createServer`.
