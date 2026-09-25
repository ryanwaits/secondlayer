---
"@secondlayer/subgraphs": minor
---

`webhook-processor` counts delivered events (never retries) and pushes them over a unix socket every 60s when `WEBHOOK_METER_SOCKET` is set — the hosted-stack event meter for plan 044's provisioner. Inert on self-host, where that env var is never set.
