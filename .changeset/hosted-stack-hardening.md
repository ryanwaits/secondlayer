---
"@secondlayer/api": patch
"@secondlayer/workload": patch
---

A hosted stack now counts every processor death, including one during a reindex, halts a subgraph that keeps killing it and cancels its operations, rolls tenants when the compose template changes, and answers a subgraph delete in seconds even when the reindex runner died.
