---
"@secondlayer/mcp": minor
---

Add `subgraphs_aggregate` tool — scalar aggregates (count/countDistinct/sum/min/max) over a subgraph table's filtered rows, mirroring the REST `/aggregate` endpoint and SDK `client.aggregate()`. Closes the gap where MCP agents could count filtered rows but not sum/min/max them. sum/min/max are numeric-only and returned as lossless strings.
