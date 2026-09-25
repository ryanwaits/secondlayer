---
"@secondlayer/platform": minor
"@secondlayer/api": minor
"@secondlayer/shared": patch
---

One metered ledger (`usage_ledger` + `meter()`) now backs every billable unit: archive partitions and hosted Index/Streams rows. A 10M-rows-per-account-per-month free allowance replaces the old free-height window and the Streams 1-day retention limit — every account now reads full history over the hosted API; rows past the allowance draw the prepaid balance. Hosted Index/Streams reads require an `sk-sl_*` key (401 without one). Stripe top-ups now also write a ledger row. New `POST /internal/meters` (guarded by `WORKLOAD_HOST_KEY`) for batched hosted-stack meters, and `GET /api/billing/usage?month=` for a per-unit usage breakdown.
