---
"@secondlayer/shared": patch
"@secondlayer/subgraphs": patch
---

Subgraph rows always match the canonical chain: a reorg rewinds the cursor in the same transaction that reverts rows, reaches halted subgraphs (which stay halted), and reindex and backfill writes near the tip are journaled so a reorg reverts them. Factory discoveries commit with their block, block ranges are read from one snapshot, a backfill seeds its cursor only from earlier attempts that started at or below it, and an operation runner that loses its lease stops. Subgraph names are capped at 54 characters, schema names are unique, and gap rows no longer overlap. Requires migrations 0197, 0200 and 0201.
