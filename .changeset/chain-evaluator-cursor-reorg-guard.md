---
"@secondlayer/subgraphs": patch
---

Fix a chain-trigger evaluator race where a reorg's cursor rewind could be clobbered by a stale, already-in-flight forward advance computed from the old canonical chain, causing blocks on the new canonical chain to never re-evaluate (under-delivery). The evaluator now snapshots an in-memory reorg generation each tick and refuses to advance the cursor if a reorg landed since the snapshot was taken.
