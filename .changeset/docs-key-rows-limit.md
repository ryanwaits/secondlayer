---
"@secondlayer/shared": patch
"@secondlayer/cli": patch
---

A read refused with `402 { error: "rows_limit_reached" }` (a signed-out docs key that has read its 100,000 rows) now raises `BillingPausedError` with that code, like the other billing refusals, instead of a plain 402. The CLI's hint for it points at making a lasting key instead of adding credits.
