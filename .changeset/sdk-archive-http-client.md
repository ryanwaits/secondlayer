---
"@secondlayer/sdk": minor
"@secondlayer/shared": minor
"@secondlayer/api": patch
"@secondlayer/cli": patch
---

Add `client.archive`: load a signed canonical manifest, quote/fetch
gated partitions, download+sha256, credits balance/checkout/refill.
OpenAPI documents the existing `/api/archive` and billing routes on
the platform spec only.
