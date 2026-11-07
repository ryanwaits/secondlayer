---
"@secondlayer/sdk": patch
---

Path segments refuse `""`, `"."` and `".."`: `webhooks.requeue(id, ".")` no longer reaches the bulk requeue route.
