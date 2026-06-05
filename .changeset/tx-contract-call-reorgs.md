---
"@secondlayer/api": minor
---

Populate `reorgs[]` on /v1/index/transactions and /v1/index/contract-calls (previously always empty despite being advertised). Reconciled at block-height granularity since the tx cursor isn't event-indexed — over-inclusive, never under-reports — so confirmed-tx consumers get the same at-least-once reorg signal the event endpoints provide
