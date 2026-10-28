---
"@secondlayer/cli": patch
---

Load typescript from node_modules instead of bundling it: smaller dist, no build-machine path in the published CLI. Scaffolded subgraphs set a start block, and deploy warns when there is none.
