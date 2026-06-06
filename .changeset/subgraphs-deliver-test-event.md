---
"@secondlayer/subgraphs": minor
---

Add `deliverTestEvent(db, sub)` (exported from `@secondlayer/subgraphs/runtime/emitter`): builds a representative webhook for a subscription's configured format, POSTs it with the same SSRF guard + timeout + signing as a real delivery, and logs a `subscription_deliveries` row with a null `outbox_id` (so it shows under the subscription's deliveries without a queued event). Factors the shared `postToSubscription` transport out of the emitter hot path (behavior unchanged).
