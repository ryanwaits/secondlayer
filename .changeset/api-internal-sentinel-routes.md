---
"@secondlayer/api": minor
---

Add `/internal/sentinel/*` routes (account resolve, grant, summary, affordable, checkout) guarded by `SENTINEL_SERVICE_KEY`, let that key meter `sentinel.*` units on `/internal/meters`, and reject a negative meter quantity for every caller.
