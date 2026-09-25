---
"@secondlayer/mcp": minor
---

`subgraphs_query` reads `/v1` now: `offset` is replaced by `cursor`, and results carry `nextCursor`/`tip` so a caller can page forward.
