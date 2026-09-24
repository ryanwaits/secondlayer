---
"@secondlayer/api": patch
"@secondlayer/shared": patch
---

Drop hosted-mode branches from the subgraph routes, which mount on self-host only: the registry cache keys by name, deploys use the plain schema name, the list's webhook counts no longer filter by account, and the hosted API no longer opens a subgraph cache listener. Removes `pgSchemaNameFor` from shared.
