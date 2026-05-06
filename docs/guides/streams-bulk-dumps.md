# Streams Bulk Dumps Quickstart

Backfill the full Stacks chain history in parquet, then tail live events from the cursor where the dump ends.

The full machine-readable contract — schema, manifest, partitioning — is in [`docs/specs/streams-bulk-dumps.md`](../specs/streams-bulk-dumps.md). This page is the operational walkthrough.

## 1. Read the manifest

The manifest lists every parquet file currently published, plus the cursor where the live tail picks up.

```bash
curl -s https://api.secondlayer.dev/public/streams/dumps/manifest | jq .
```

Key fields:

- `latest_finalized_cursor` — the cursor your live tail should resume from after the parquet sync.
- `coverage.to_block` — the highest block number covered by the published files.
- `files[]` — every parquet object, with `path`, `from_block`, `to_block`, `row_count`, and `sha256`.

## 2. Sync the parquet files

The parquet objects are served from a public R2 bucket. Pull them with whatever tool fits your environment.

DuckDB reads them in place — no sync step required:

```sql
SELECT event_type, count(*) AS rows
FROM read_parquet(
  'https://pub-08fa583203de40b2b154e6a56624adc2.r2.dev/stacks-streams/mainnet/v0/events/block_height/*/events.parquet'
)
GROUP BY event_type
ORDER BY rows DESC;
```

For a local copy, sync via S3-compatible API:

```bash
aws s3 sync \
  s3://$STREAMS_BULK_BUCKET/stacks-streams/mainnet/v0/events \
  ./stacks-streams/events \
  --endpoint-url "$STREAMS_BULK_R2_ENDPOINT"
```

Verify each file's `sha256` against the manifest as you go.

## 3. Tail live events from the cursor

Once the parquet load is done, switch to the cursor API for everything past `latest_finalized_cursor`.

```typescript
import { createStreamsClient } from "@secondlayer/sdk";

const manifest = await fetch(
  "https://api.secondlayer.dev/public/streams/dumps/manifest",
).then((r) => r.json());

const client = createStreamsClient({
  apiKey: process.env.SECONDLAYER_API_KEY!,
});

for await (const event of client.events.consume({
  cursor: manifest.latest_finalized_cursor,
  batchSize: 1000,
})) {
  // dedupe downstream writes by event.cursor
}
```

## 4. Handle reorgs

Bulk dumps publish only canonical events at least 144 Stacks blocks behind tip. Live tails through `/v1/streams/events` may emit `chain.reorg` markers — your consumer should dedupe by `cursor` and apply reorg markers if you store post-finality data.

## Schema versioning

The parquet schema is versioned. The current version is `0`. Schema changes ship a new `version` (e.g., `v1`) under a parallel object prefix; `v0` stays available until deprecated. Pin to the version you tested against.

## Freshness

`/public/status` includes a `streams.dumps` block:

```json
{
  "streams": {
    "dumps": {
      "status": "ok",
      "latest_finalized_cursor": "189999:42",
      "generated_at": "2026-05-05T12:34:56Z",
      "to_block": 189999,
      "lag_blocks": 5001
    }
  }
}
```

`lag_blocks` is the gap between the chain tip and the last published range — expect ~10K + finality lag (144) blocks at any given moment.
