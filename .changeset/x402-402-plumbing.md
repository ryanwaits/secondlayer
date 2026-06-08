---
"@secondlayer/shared": minor
---

x402 rail: add HTTP 402 to the error system — `PAYMENT_REQUIRED` code + `402` in `CODE_TO_STATUS`, a `PaymentRequiredError` carrying the challenge in `details`, and the `x402_payments` control-plane ledger (migration `0091`, `Database` type, `TABLE_TO_DB` registration).
