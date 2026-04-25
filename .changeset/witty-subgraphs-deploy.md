---
"@secondlayer/api": patch
"@secondlayer/bundler": patch
"@secondlayer/subgraphs": patch
"@secondlayer/cli": minor
---

Stabilize subgraph deploys by importing generated handlers through file URLs,
evaluating bundled subgraphs from temporary modules instead of data URIs, and
adding a CLI deploy dry-run preview. ABI scaffolding now reports the actual
Secondlayer node source and fails quickly when contract fetches are unavailable.
