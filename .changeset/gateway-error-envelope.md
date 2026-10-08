---
"@secondlayer/api": patch
"@secondlayer/workload": patch
---

Hosted subgraph and webhook errors now carry the same envelope as the platform API: the gateway forwards one `X-Request-Id` end to end, adds `request_id`, `code` and `feedback.url` to JSON errors, and ships failed-request records to app-server (`POST /internal/failed-requests`) for feedback evidence.
