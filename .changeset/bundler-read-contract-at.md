---
"@secondlayer/bundler": patch
---

A subgraph that imports `readContractAt` from `@secondlayer/subgraphs` now bundles. The bundler's stub exported only `defineSubgraph`, so every deploy of a handler using `readContractAt` failed with `No matching export`.
