---
"@secondlayer/api": patch
---

fix: x402 spot feed retry storm — gate refresh cadence by `nextAttemptAt` so a failed CoinGecko fetch backs off (30s, or the 429 `Retry-After`) instead of re-firing on every request; debounced failure logging; warm the cache at boot; coarser 5m success cadence. STX/sBTC now price off the live feed instead of being pinned to the env fallback. Also make the settle/drawdown `recordSpend` funnel injectable so the x402 middleware tests run without a Postgres connection (fixes 4 DB-dependent test failures).
