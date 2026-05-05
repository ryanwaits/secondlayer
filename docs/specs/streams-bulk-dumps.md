# Stacks Streams Bulk Dumps

Status: private/staging v0 contract draft.

Stacks Streams bulk dumps are the cold backfill path for L1 events. They are parquet files generated from canonical Stacks Streams events, published with a machine-readable manifest. Public URLs are not launched until the manifest, partition, URL, and finality contracts are explicitly approved.

## Layout

Object prefix:

```text
stacks-streams/mainnet/v0
```

Objects:

```text
stacks-streams/mainnet/v0/events/block_height/0000180000-0000189999/events.parquet
stacks-streams/mainnet/v0/manifest/latest.json
stacks-streams/mainnet/v0/manifest/history/20260505T123456Z.json
stacks-streams/mainnet/v0/schema.json
```

Files are immutable once published. Corrections use new object names and a newer manifest.

## Partitioning And Finality

- Partitions are inclusive Stacks block-height ranges.
- v0 range size is 10,000 Stacks blocks.
- Only complete ranges publish.
- A range is eligible when its end block is at least 144 Stacks blocks behind the current canonical tip.
- v0 rows contain canonical events only. Reorg metadata remains in the Streams API and manifest/finality policy.

## Parquet Schema

Schema version: `0`.

Columns:

| Column | Type | Nullable | Notes |
|---|---:|---:|---|
| `cursor` | string | no | `<block_height>:<event_index>` |
| `block_height` | int64 | no | Canonical Stacks block height |
| `index_block_hash` | string | no | Canonical Stacks index block hash |
| `burn_block_height` | int64 | no | Bitcoin burn block height |
| `burn_block_hash` | string | yes | Null for historical rows where unavailable |
| `tx_id` | string | no | Parent transaction id |
| `tx_index` | int32 | no | Parent transaction index within the block |
| `event_index` | int32 | no | Streams event index within the block |
| `event_type` | string | no | Normalized Streams event type |
| `contract_id` | string | yes | Contract id for contract-scoped events |
| `ts` | string | no | ISO-8601 UTC block timestamp |
| `payload_json` | string | no | Deterministic JSON payload |
| `partition_block_range` | string | no | Zero-padded inclusive range label |

## Manifest

`manifest/latest.json` points at the current file set. Historical manifests are retained under `manifest/history/`.

Required fields:

- `dataset`
- `network`
- `version`
- `schema_version`
- `generated_at`
- `producer_version`
- `finality_lag_blocks`
- `latest_finalized_cursor`
- `coverage`
- `files[]`

Each file entry includes path, block range, min/max cursor, row count, byte size, SHA-256 checksum, schema version, and creation timestamp.

## Customer Workflow Draft

1. Sync parquet objects listed in `manifest/latest.json`.
2. Load parquet with DuckDB, Spark, pandas, or a warehouse.
3. Store the manifest `latest_finalized_cursor`.
4. Tail live events with `GET /v1/streams/events?cursor=<latest_finalized_cursor>`.
5. Dedupe downstream writes by `cursor`.

DuckDB example:

```sql
SELECT event_type, count(*) AS rows
FROM read_parquet('stacks-streams/mainnet/v0/events/block_height/*/events.parquet')
GROUP BY event_type
ORDER BY rows DESC;
```

Manifest inspection:

```bash
curl -s "$STREAMS_BULK_BASE_URL/manifest/latest.json" | jq .
```

R2/S3-compatible sync shape:

```bash
aws s3 sync \
  s3://$STREAMS_BULK_BUCKET/stacks-streams/mainnet/v0/events \
  ./stacks-streams/events \
  --endpoint-url "$STREAMS_BULK_R2_ENDPOINT"
```

## Private/Staging Commands

Generate a local range:

```bash
bun run packages/indexer/src/streams-bulk/export.ts \
  --from-block 180000 \
  --to-block 189999 \
  --output-dir ./tmp/streams-bulk
```

Generate and upload the latest finalized complete range:

```bash
bun run packages/indexer/src/streams-bulk/export.ts \
  --latest-finalized \
  --upload
```

Smoke check the uploaded manifest and one parquet object:

```bash
bun run packages/indexer/src/streams-bulk/smoke.ts
```
