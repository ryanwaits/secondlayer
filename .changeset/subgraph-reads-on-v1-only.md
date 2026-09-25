---
"@secondlayer/sdk": major
---

Subgraph table reads move onto `/v1` only. `queryTable`, `queryTableCount` and `queryTableAggregate` (the `/api` offset-read client) are removed — `rows`, `count` and `aggregate` read `/v1` instead, and the typed `findMany` does too.

`findMany` now returns a cursor page, not a bare array: `{ rows, nextCursor, tip }`. `FindManyOptions.offset` is gone; `orderBy` accepts a single-column object only (the array form for multi-column sort is removed) — a second key rejects the returned promise, since `/v1`'s keyset cursor pairs one sort column with `_id` as a tiebreaker. Pass `cursor`/`nextCursor` to page.
