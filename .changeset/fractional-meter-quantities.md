---
"@secondlayer/shared": patch
"@secondlayer/platform": patch
---

Meter fractional memory and storage quantities. `usage_ledger.quantity` is now `numeric`, so hosted-stack GB-hour and GB-day samples record and bill instead of failing the flush.
