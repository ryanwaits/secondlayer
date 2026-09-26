---
"@secondlayer/web": patch
---

The dashboard's webhooks proxy now forwards `GET /:id/activity` and `GET /:id/deliveries/:deliveryId`. Its allowlist refused both with 405, so in production the detail page's 7-day events chart, delivered stat, catch-up bar and delivery card never loaded.
