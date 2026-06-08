---
"@secondlayer/api": minor
---

x402 middleware + ledger (Sprint 3): `x402PaymentRequired({surface})` runs the full x402 v2 handshake — account-backed callers bypass, accountless callers get a base64 `PAYMENT-REQUIRED` challenge, and a signed retry is verified (incl. nonce-in-memo binding), settled confirmed-tier, recorded to the `x402_payments` ledger, and acknowledged with a `PAYMENT-RESPONSE` receipt. Nonce replay and broadcast-but-unconfirmed both return 402.
