---
"@secondlayer/shared": minor
"@secondlayer/subgraphs": patch
"@secondlayer/api": patch
---

A subgraph you delete and redeploy can no longer be halted or flipped by work that belonged to the old one. Status changes now follow the subgraph id, and `transitionSubgraph` takes the id instead of the name.
