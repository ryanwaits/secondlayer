---
"@secondlayer/subgraphs": patch
---

A hosted trait-scoped subgraph's contract list is now refreshed as soon as the registry classifies past the block being processed, instead of on a 5 second timer, so a token classified moments after its deploy is included for the blocks that follow it.
