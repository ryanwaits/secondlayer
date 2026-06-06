---
"@secondlayer/api": patch
---

Add `POST /api/subscriptions/:id/test` — sends a one-off test webhook to the subscription's URL (built for its configured format, SSRF-guarded) and logs it as a delivery row, so it appears under the subscription's deliveries.
