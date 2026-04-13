---
"@secondlayer/mcp": minor
---

MCP parity for subgraph source capture.

- New `subgraphs_read_source` tool wraps `GET /api/subgraphs/:name/source` so external MCP clients (Claude Desktop, Inspector) can fetch deployed TypeScript source. Mirrors the `read_subgraph` web chat tool and returns the same `{ readOnly, reason }` payload for subgraphs deployed before source capture landed.
- `subgraphs_deploy` now threads `sourceCode` (the raw TypeScript passed in) into the deploy call so MCP-deployed subgraphs show up in the chat authoring loop's read/edit flow alongside web-deployed ones.
