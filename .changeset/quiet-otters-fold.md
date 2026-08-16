---
"@secondlayer/api": minor
---

Stop mounting subgraph and subscription routes on platform/archive deployments. Deploying and executing handler code, and delivering webhooks, is self-host only now — the archive deployment serves data and does not run anyone's workload. `/api/subgraphs` and `/api/subscriptions` 404 in platform/archive mode; self-hosted `oss` instances are unaffected.
