---
"@secondlayer/api": patch
"@secondlayer/workload": patch
---

Hosted stacks now run a subgraph processor under gVisor with a metered read key, route subgraph requests through the gateway, refuse sources a stack can't feed, and restart a processor that stalls or runs out of memory.
