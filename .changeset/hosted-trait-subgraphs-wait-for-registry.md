---
"@secondlayer/shared": patch
"@secondlayer/subgraphs": patch
---

Hosted trait-scoped subgraphs now wait for the contract registry like self-hosted ones: catch-up stops at the height the Index tip reports as fully classified, so a token deployed just below the tip no longer loses its first events. `IndexHttpClient` gains `getRegistryClassifiedThrough()`.
