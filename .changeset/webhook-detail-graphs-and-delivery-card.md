---
"@secondlayer/web": minor
"@secondlayer/api": patch
"@secondlayer/shared": patch
---

The webhook detail page answers "is it firing, did anything fail, and how much is piling up" directly: a stacked events-per-hour chart (delivered/waiting/gave up, 7 days), a last-100-attempts ribbon, and a catch-up bar while a backlog drains. The insight card now carries a graph as evidence for the four detectors that have one (receiver down, rate-limited, slow, running behind), each pinned to the same numbers already shown in its evidence list. Clicking a delivery opens the app's own `FloatingCard` with payload, response, and response-header tabs (client-side Shiki, loaded on first open), block/tx context, and a Copy-as-curl / Resend action. `GET /:id/deliveries/:deliveryId` now also returns `eventIndex`, read from the outbox row's `row_pk`.
