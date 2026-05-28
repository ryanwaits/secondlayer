---
"@secondlayer/sdk": minor
"@secondlayer/subgraphs": minor
"@secondlayer/api": minor
---

Add `in`/`notIn`/`like` filter operators and deterministic multi-column ordering to the subgraph query client. `findMany`/`count` now accept `{ col: { in: [...] }, name: { like: "a%" } }` and `orderBy: [["blockHeight","desc"],["id","asc"]]`. All values are parameterized server-side (`IN ($1,$2,…)`); `in`/`notIn` are comma-encoded over REST so values cannot contain commas.
