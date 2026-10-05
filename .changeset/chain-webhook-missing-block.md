---
"@secondlayer/subgraphs": patch
---

Chain webhooks no longer skip a block when its data is briefly unavailable; the evaluator waits and retries it.
