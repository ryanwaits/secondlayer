# STX Transfers Dataset Schema

Status: v0 contract.

The STX Transfers dataset captures every canonical STX transfer event on Stacks. It is the simplest of the five Foundation Datasets — STX is a native token, so every transfer is already structured at the protocol layer.

## Layout

Object prefix:

```text
stacks-datasets/mainnet/v0/stx-transfers
```

Objects:

```text
stacks-datasets/mainnet/v0/stx-transfers/data/block_height/0000180000-0000189999/data.parquet
stacks-datasets/mainnet/v0/stx-transfers/manifest/latest.json
stacks-datasets/mainnet/v0/stx-transfers/manifest/history/20260505T123456Z.json
stacks-datasets/mainnet/v0/stx-transfers/schema.json
```

Files are immutable once published. Corrections use new object names and a newer manifest.

## Source

STX transfers are sourced from canonical `stx_transfer_event` rows in the indexer's L1 event store. No decoding is required — the protocol emits sender, recipient, and amount natively.

## Partitioning And Finality

- Partitions are inclusive Stacks block-height ranges.
- v0 range size is 10,000 Stacks blocks (matches Streams bulk dumps).
- Only complete ranges publish.
- A range is eligible when its end block is at least 144 Stacks blocks behind the canonical tip.
- v0 rows contain canonical events only.

## Parquet Schema

Schema version: `0`.

| Column | Type | Nullable | Notes |
|---|---:|---:|---|
| `cursor` | string | no | `<block_height>:<event_index>`, matches Streams cursor |
| `block_height` | int64 | no | Canonical Stacks block height |
| `block_time` | string | no | ISO-8601 UTC block timestamp |
| `tx_id` | string | no | Parent transaction id |
| `tx_index` | int32 | no | Parent transaction index within the block |
| `event_index` | int32 | no | Streams event index within the block |
| `sender` | string | no | STX sender address |
| `recipient` | string | no | STX recipient address |
| `amount` | string | no | Amount in microSTX, decimal string (preserves u128 precision) |
| `memo` | string | yes | Hex-encoded memo if present, otherwise null |
| `partition_block_range` | string | no | Zero-padded inclusive range label |

Compression: SNAPPY.

## API Row Shape

`GET /v1/datasets/stx-transfers` returns the same columns as JSON:

```json
{
  "events": [
    {
      "cursor": "189999:42",
      "block_height": 189999,
      "block_time": "2026-05-05T12:34:56.000Z",
      "tx_id": "0xabc...",
      "tx_index": 12,
      "event_index": 42,
      "sender": "SP1...",
      "recipient": "SP2...",
      "amount": "1000000",
      "memo": "0xdead..."
    }
  ],
  "next_cursor": "190001:7",
  "tip": { "block_height": 195000, "lag_seconds": 4 }
}
```

Filters: `sender`, `recipient`, `from_block`, `to_block`. Pagination: `cursor` (resume from a prior `next_cursor`).

## Manifest

`manifest/latest.json` points at the current published file set. Historical manifests are retained under `manifest/history/`. Same shape as the Streams bulk dump manifest, scoped to dataset `stacks-datasets/stx-transfers`:

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

## Freshness

`/public/status.datasets[]` includes an entry for `stx-transfers` with `latest_finalized_cursor`, `generated_at`, `to_block`, and `lag_blocks` against the current chain tip.

## Versioning

Schema changes ship under a new `version` (e.g., `v1`) at a parallel object prefix; `v0` stays available until deprecated. Pin to the version you tested against.
