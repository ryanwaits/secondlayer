# indexer-from-zero

Build an indexer from the raw inputs on [Secondlayer Streams](https://secondlayer.tools/streams) — the same firehose Secondlayer's own decoder runs on.

```bash
bun install
SL_API_KEY=sk-sl_…  SL_STREAMS_DUMPS_URL=…  bun run indexer.ts
```

A free key takes one curl, no signup: `curl -X POST https://api.secondlayer.tools/v1/keys`.

What it demonstrates:

- **Cold history from signed parquet dumps** — `events.replay()` downloads each file with its sha256 checked against the ed25519-signed manifest, then seams to the live firehose strictly after the dumped coverage. No gap, no dupe.
- **Checkpointed live tail** — `onBatch` returns the cursor you committed; restarts resume there. The commented `events.consume()` variant adds `onReorg` with automatic rewind to the fork point.
- **Raw means raw** — payloads are normalized but undecoded Clarity. Decoding is your job at this level; if you want it done already, that's [Index](https://secondlayer.tools/index-api), one product up.

No indexer at all? The dumps are plain parquet:

```bash
sl streams pull --to ./dump
duckdb -c "SELECT event_type, count(*) FROM read_parquet('./dump/**/*.parquet') GROUP BY 1 ORDER BY 2 DESC;"
```
