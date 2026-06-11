---
"@secondlayer/api": patch
---

Billing resolve now recognizes trialing subscriptions — the post-checkout fast-resolve filtered on status "active", silently no-opping for every 30-day-trial signup and leaving the plan flip to the webhook race.
