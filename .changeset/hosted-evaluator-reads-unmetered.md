---
"@secondlayer/shared": patch
"@secondlayer/api": patch
"@secondlayer/web": patch
---

Hosted webhook evaluator reads are no longer metered to the customer. The per-tenant `hosted-stack` key is now minted at a first-party `internal` tier (migration 0141 widens the `api_keys.tier` check and moves existing keys onto it), and the Index/Streams credits gates skip metering and the monthly-allowance 402 for that tier. Webhook customers pay per event only; free Index and Streams rows stay theirs, and an over-allowance account can no longer have its webhooks silently stopped by a 402 on our own reads. The credits page now labels the meter "Free Index and Streams rows" and says webhooks don't use them.
