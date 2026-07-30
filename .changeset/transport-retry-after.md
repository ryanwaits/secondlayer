---
"@secondlayer/stacks": patch
---

`fetchWithRetry` now honors a server-sent `Retry-After` header (delta-seconds or HTTP-date) on 429/503 instead of always using the linear backoff. Values above 60s fall back to the normal backoff so a transport-level retry never stalls for minutes.
