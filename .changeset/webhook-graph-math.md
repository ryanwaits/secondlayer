---
"@secondlayer/web": minor
---

Adds `lib/webhook-graphs.ts`, pure series math for the webhook detail page's charts: the last-100-attempts ribbon, the 429 share per hour, the response-time histogram (windowed the same way `receiver_slow`'s evidence is, so the two never disagree), the block-to-delivery lag series, and the catch-up bar's progress/rate/ETA.
