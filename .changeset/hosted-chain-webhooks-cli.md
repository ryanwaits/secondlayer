---
"@secondlayer/cli": minor
---

`secondlayer webhooks` now works against the hosted merchant (`api.secondlayer.tools`) when `SECONDLAYER_API_KEY` (`sk-sl_*`) is set — chain webhooks only for now. Without an account key, hosted stays refused exactly as before; self-host is unaffected.
