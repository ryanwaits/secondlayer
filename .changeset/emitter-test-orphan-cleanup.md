---
"@secondlayer/subgraphs": patch
---

Test hygiene, no production code change: the 7 emitter test suites deleted only their `webhooks` rows in `afterAll`, orphaning `webhook_deliveries` rows in the shared CI-mirror DB (`webhook_outbox` already cascades on webhook delete; `webhook_deliveries.webhook_id` carries no FK). Each `afterAll` now deletes its own outbox + delivery rows by webhook id first. A small residual race remains — `stopEmitter()` doesn't await an in-flight `claimAndDrain` call, so a delivery write can land just after teardown — worth a follow-up if it grows.
