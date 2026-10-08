---
"@secondlayer/api": minor
"@secondlayer/shared": minor
"@secondlayer/platform": minor
"@secondlayer/worker": patch
---

Every JSON error now carries `request_id` (also the `X-Request-Id` header on every response), a `code` derived from the status when a route set none, and `feedback.url` (hosted `/v1/feedback`, self-host GitHub issues). Hosted keeps a 24h account-scoped record of failed requests (`api_failed_requests`, migration 0155) for feedback evidence; purged hourly by the worker.
