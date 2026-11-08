---
"@secondlayer/shared": patch
---

A chain whose stored history starts above genesis (a Clarinet devnet announces block 0, then first shows the chain at its cached height) now counts contiguity from its real floor instead of 0 or 1, so decoders, the Streams tip and subgraphs advance instead of stalling at the start.
