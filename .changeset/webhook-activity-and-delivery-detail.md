---
"@secondlayer/sdk": minor
"@secondlayer/shared": minor
"@secondlayer/api": patch
---

Two new tenant-scoped reads for the webhook detail page. `GET /api/webhooks/:id/activity` returns 168 hours of zero-filled delivered/waiting/gave-up counts from `webhook_outbox`, plus the current queue depth, next retry, and last success. `GET /api/webhooks/:id/deliveries/:deliveryId` returns one delivery attempt with its outbox context (payload, event/tx/block, response headers), left-joined since the outbox row may already be compacted away. Both are exposed on the SDK's `Webhooks` client as `activity()` and `delivery()`.
