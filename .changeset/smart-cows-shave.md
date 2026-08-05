---
"@secondlayer/subgraphs": patch
---

Stop `ctx.increment` from silently dropping a delta when another transaction creates the row first.

The increment flush is UPDATE-first with a guarded `INSERT ... WHERE NOT EXISTS`, so under READ COMMITTED two block transactions writing the same key while the row is absent both saw `UPDATE → 0 rows`; whichever inserted second matched the winner's committed row in its `NOT EXISTS` guard and wrote nothing at all — no error, no constraint violation, delta gone. The flush now branches on statement rowcounts and re-runs the UPDATE when the INSERT wrote no row, so the delta lands on the concurrently created row. The retry is reached only when neither the UPDATE nor the INSERT touched a row, so it cannot double-apply, and the UPDATE-first ordering (which keeps CHECK constraints evaluating the final value, not the proposed delta) is unchanged.
