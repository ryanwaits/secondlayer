---
"@secondlayer/api": patch
"@secondlayer/cli": patch
---

add `sl billing status` — read-only snapshot of plan, Stripe subscription, trial end, renewal date, and applied discount. Backed by new `GET /api/billing/status` endpoint. Lets customers verify post-checkout that the webhook landed before retrying `sl instance create`.
