---
"@secondlayer/subgraphs": minor
---

Schema differ correctness:

- Flipping `indexed`/`search` on an existing column is no longer a breaking change: it now applies `CREATE INDEX CONCURRENTLY` / `DROP INDEX CONCURRENTLY` in place instead of forcing `DROP SCHEMA … CASCADE` plus a full reindex.
- `uniqueKeys` and composite `indexes` changes are no longer invisible to the differ. Added uniqueKeys run `ALTER TABLE … ADD CONSTRAINT` in place (previously the deploy reported success, created nothing, and every later `upsert` hit `ON CONFLICT` against a constraint that did not exist). Removed uniqueKeys are classified breaking.
- Handler-only redeploys now return a warning that the new logic applies from the current tip only — history stays computed by the previous handler unless reindexed.
- `findMany({ fields })` narrows the returned row type to the requested columns. The server already projected the SELECT, so unrequested fields were physically absent while the type promised they exist.
