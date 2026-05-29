---
"@secondlayer/api": patch
---

Add an in-process origin cache for finalized Streams event pages. Immutable pages (resolved range past the finality boundary) memoize their event payload and skip the Postgres read on repeat, attaching the fresh tip per request. Bounded LRU; per-tenant rate-limit/metering still run on every request.
