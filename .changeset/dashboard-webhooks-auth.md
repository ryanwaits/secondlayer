---
"@secondlayer/api": minor
---

`POST /internal/keys/introspect` now resolves a dashboard session token (`ss-sl_*`) the same way it resolves an account key (`sk-sl_*`), so the web app's own session can manage hosted webhooks through the workload gateway instead of 401ing. `GET /api/webhooks/:id/deliveries` now includes `blockTime` (ISO timestamp of the delivered event's block, `null` when unavailable) on each delivery.
