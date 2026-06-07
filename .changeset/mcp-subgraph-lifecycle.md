---
"@secondlayer/mcp": minor
---

Add subgraph lifecycle tools to the MCP server: `subgraphs_backfill` (non-destructive range fill, the only fill path for BYO subgraphs), `subgraphs_stop` (cancel an in-flight reindex/backfill), and `subgraphs_gaps` (list missing block ranges). Extend `subgraphs_deploy` with `databaseUrl` (BYO data plane) and `dryRun` (validate/preview without writing); a refused BYO breaking change now returns the drop+rebuild migration plan as an actionable result instead of an opaque error.
