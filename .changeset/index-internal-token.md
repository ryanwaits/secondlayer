---
"@secondlayer/shared": minor
"@secondlayer/api": patch
---

Add an internal Index read credential (`@secondlayer/shared/index-internal-auth`), seeded into the Index token store as an unmetered enterprise tenant (no `account_id`). Lets first-party consumers — the subgraph processor — read `/v1/index` over HTTP without self-metering. Resolves from `INDEX_INTERNAL_API_KEY`.
