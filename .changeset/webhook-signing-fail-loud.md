---
"@secondlayer/shared": patch
"@secondlayer/subgraphs": patch
---

Fail loud on boot when the webhook signing key is absent — the subscription-processor now refuses to start in prod (unless `ALLOW_UNSIGNED_WEBHOOKS=true`) rather than silently shipping unsigned deliveries
