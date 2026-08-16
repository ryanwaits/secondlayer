---
"@secondlayer/api": minor
---

Retire the four-rung paid tier ladder (`free`/`build`/`scale`/`enterprise`) on Index and Streams. There are now exactly two kinds of caller: a metered `free` account and a first-party `internal` service credential — no paid ladder, no meter bypass. Deletes the six hardcoded `*_build_test`/`*_scale_test`/`*_enterprise_test` bearer tokens that granted unmetered access with no `account_id`. A database key with a legacy paid-tier pin on `api_keys.tier` now always resolves to `free`; the column stays but is no longer authority. Index rate-limit 429s no longer advertise an upgrade path (`upgrade_url`/`required_tier`) to a product that no longer exists.
