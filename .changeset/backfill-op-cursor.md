---
"@secondlayer/subgraphs": minor
"@secondlayer/shared": minor
---

backfill ops get their own crash checkpoint (cursor_block): written blocks advance it conditionally in the same transaction, replays skip, lost races roll back as skips, requeues inherit the committed prefix, and backfill walks never touch the live subgraph cursor. RELEASE NOTE: subgraphs + api must deploy in the same train (op-cursor enqueue semantics).
