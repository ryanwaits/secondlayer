---
"@secondlayer/shared": patch
"@secondlayer/api": patch
"@secondlayer/platform": patch
"@secondlayer/worker": patch
---

An expired key now answers 401 `KEY_EXPIRED` instead of a misleading "revoked", and every reader judges a key live through one function. One account per email address regardless of case (unique index on `lower(email)`); a tenant key is unique per account and name while active. A new sign-in code voids older unused ones, expired sessions and codes are purged after 30 days, and a Stripe customer race keeps one customer. Update-list confirmations no longer undo a racing unsubscribe, contact requests the operator was never emailed about are retried, and a push subscription is dropped after 10 consecutive failures.
