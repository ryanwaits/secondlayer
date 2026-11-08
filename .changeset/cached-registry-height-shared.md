---
"@secondlayer/shared": patch
"@secondlayer/subgraphs": patch
---

The contract registry's classified height is now read through one shared cache that keeps serving the last value while it refreshes in the background, so trait-scoped subgraphs and the API never wait on the slow query after the first read.
