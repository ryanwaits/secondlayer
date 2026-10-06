---
"@secondlayer/api": patch
---

`GET /v1/index/blocks` no longer bills block headers or returns `402` past the allowance; only event and transaction rows are billed.
