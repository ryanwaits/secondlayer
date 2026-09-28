---
"@secondlayer/api": minor
---

`GET /api/billing/usage` now also returns `daily` (spend by UTC day), `burn` (trailing-24h rate), and `service` (delivery service state + last 24h memory). `POST /internal/meters` accepts an optional `observedQuantity` per item.
