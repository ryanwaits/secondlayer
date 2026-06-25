---
"@secondlayer/api": patch
"@secondlayer/shared": patch
---

Paginate the subscriptions list endpoint (default 50, max 200).

`GET /api/subscriptions` now accepts `_limit` (1–200, default 50) and `_offset` (default 0) query params. Previously the endpoint fetched every subscription row for the account with no LIMIT. The `listSubscriptions` query in `@secondlayer/shared` accepts an optional `{ limit, offset }`; pagination applies only when provided, so existing internal callers (quota count, trigger matcher) remain unbounded.
