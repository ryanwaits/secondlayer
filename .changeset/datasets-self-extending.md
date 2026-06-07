---
"@secondlayer/sdk": minor
"@secondlayer/mcp": minor
---

Add `Datasets.get(slug, params)` — a generic reader that resolves any slug against the live `/v1/datasets` catalog and returns a uniform `{ rows, next_cursor, tip }` envelope for cursor and bespoke datasets alike (single-record datasets like `bns/resolve` come back as 0-or-1 rows). Known cursor slugs keep a network-free fast path; the catalog is fetched once and cached. The MCP `datasets_query` tool now routes through `get()`, so every dataset returned by `datasets_list` — including `bns/resolve`, `bns/names`, `bns/namespaces`, `network-health/summary`, and any dataset added later — is queryable, in either family (`sbtc-events`) or path (`sbtc/events`) slug form. `query()` is unchanged (cursor-only).
