---
"@secondlayer/sdk": minor
---

Add `events.replay({ from, onDumpFile, onBatch })`: backfill from bulk dumps then continue live in one call. It iterates finalized dump files in block order (you process the parquet with your own tooling via `onDumpFile`), then tails live from the manifest's `latest_finalized_cursor` — exclusive input, so there's no gap or duplicate at the dump→live seam.
