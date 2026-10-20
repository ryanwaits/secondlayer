---
"@secondlayer/api": minor
"@secondlayer/platform": minor
"@secondlayer/web": patch
---

Sentinel bills on its own Stripe subscriptions, so the platform's Sentinel money surface is gone. `/internal/sentinel` keeps only `accounts/resolve`, `accounts/link`, `tokens/resolve` and `keys`; `accounts/grant`, `accounts/summary`, `accounts/settle`, `settings`, `affordable` and `checkout` are removed, and the Sentinel service key no longer opens `/internal/meters`. `sentinel.check_run` and `sentinel.monitored_event` join the retired meter units (priced for history, never charged). The Stripe webhook acks and ignores events tagged `metadata.product = "sentinel"`. `scripts/ops/waive-sentinel-owed.ts` waives owed `sentinel.*` usage.
