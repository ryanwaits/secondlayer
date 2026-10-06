---
"@secondlayer/shared": patch
---

`IndexHttpClient.walkEvents` accepts a contract id so a caller can fetch one contract's events instead of every event of the type, and a subgraph delete can settle a cancelled operation whose runner has died.
