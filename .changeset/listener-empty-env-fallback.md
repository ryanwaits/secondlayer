---
"@secondlayer/shared": patch
"@secondlayer/subgraphs": patch
---

Treat an empty-string SOURCE_/TARGET_DATABASE_URL (passed through docker-compose as "") as unset in the LISTEN/NOTIFY and subgraph-cache paths — `||` instead of `??` — so single-DB mode falls back to DATABASE_URL instead of crashing the subgraph processor
