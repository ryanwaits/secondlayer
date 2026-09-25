---
"@secondlayer/subgraphs": major
---

`FindManyOptions` drops `offset` and the multi-column `orderBy` array form (single-column object only) — the `/v1` read surface it targets has no offset pagination and sorts by one column. `SubgraphTableClient.findMany` now returns `FindManyPage<TRow>` (`{ rows, nextCursor, tip }`) instead of a bare row array.
