---
"@secondlayer/bundler": patch
---

Drop the ineffective `?t=` import cache-buster in `bundleSubgraphCode` — Bun ignores file-URL query cache-busters, and per-call freshness is already guaranteed by the unique `mkdtemp` path. No behavior change.
