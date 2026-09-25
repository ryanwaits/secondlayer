---
"@secondlayer/api": minor
---

`/api/subgraphs/:name/:table`, `/count` and `/aggregate` (the offset-paginated list route and its count/aggregate siblings) are removed. Subgraph table reads live on `/v1/subgraphs/:name/:table` only — cursor-paginated, one surface for one rule to enforce. `/api/subgraphs` keeps deploy and ops.
