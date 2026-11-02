---
"@secondlayer/indexer": patch
---

Remove the opt-in `/internal/observer-events` export route, `OBSERVER_HTTP_EXPORT` and `OBSERVER_HTTP_EXPORT_TOKEN`. Its only in-repo consumer, the subgraph `observer-http` source, was removed in `@secondlayer/subgraphs@8.0.0`.
