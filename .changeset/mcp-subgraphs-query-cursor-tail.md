---
"@secondlayer/mcp": patch
---

`subgraphs_query` tells agents to tail with `cursor = next_cursor ?? cursor` instead of an `_id.gt` filter.
