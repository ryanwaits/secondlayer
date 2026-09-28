---
"@secondlayer/subgraphs": minor
---

Adds a second chain-trigger evaluator loop for Runes webhooks (`chain=bitcoin` Streams events), running under the same leader lock as the Stacks evaluator with its own cursor and reorg poll. Fixes a reorg-handling bug where a Bitcoin fork's cursor rewind could sweep up Stacks apply rows (and vice versa) at an overlapping numeric block height — reorg handling is now scoped per chain.
