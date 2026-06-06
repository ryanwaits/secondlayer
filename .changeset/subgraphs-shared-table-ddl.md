---
"@secondlayer/subgraphs": patch
---

Fix: an additively-created subgraph table (new table added to an existing subgraph) now gets its UNIQUE constraints, composite indexes, column defaults, and foreign keys — previously the deployer's additive path hand-rolled a bare CREATE TABLE that omitted them, so a handler `upsert` (`ON CONFLICT`) on such a table failed at runtime with "no unique constraint matching the ON CONFLICT specification". The full generator and the additive path now share one `emitTableDDL`/`emitForeignKeyDDL` emitter so they can't drift.
