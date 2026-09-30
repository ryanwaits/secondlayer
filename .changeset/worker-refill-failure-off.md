---
"@secondlayer/worker": patch
---

Auto top-up now turns itself off after a declined or authentication-required charge, emails the owner once, and never retries; each charge carries a per-attempt Stripe idempotency key.
