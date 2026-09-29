---
"@secondlayer/api": minor
---

Add `/internal/sentinel/*` routes (account resolve, link, grant, summary, affordable, checkout), scoped to accounts Sentinel created or that opted in, with a single $5 starter grant per account, guarded by `SENTINEL_SERVICE_KEY`, let that key meter `sentinel.*` units on `/internal/meters`, and reject a negative meter quantity for every caller.
