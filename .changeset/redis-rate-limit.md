---
"@secondlayer/api": patch
---

Back the API rate limiters with a shared Redis store (fail-open) so limits stay correct across multiple API instances; falls back to process-local limits when REDIS_URL is unset
