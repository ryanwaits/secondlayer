---
"@secondlayer/api": minor
---

Add `/internal/sentinel/accounts/settle` and `/internal/sentinel/settings`, and return `owedUsdMicros` and `refill` from the Sentinel account summary. The auto top-up and spend-cap validation now lives in shared helpers used by both the session and Sentinel routes.
