---
"@secondlayer/subgraphs": patch
"@secondlayer/shared": patch
---

Remove the unused subprocess sandbox for subgraph handlers and its `sandbox_workers` column; hosted stacks isolate handlers with gVisor instead.
