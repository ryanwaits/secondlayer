---
"@secondlayer/subgraphs": patch
---

fix(subgraphs): widen the webhook outbox lock window past the maximum delivery
timeout so a slow-but-alive receiver is not re-claimed mid-delivery
