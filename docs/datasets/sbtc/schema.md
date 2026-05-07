# sBTC Dataset Schema

Status: v0 contract.

The sBTC dataset tracks the full lifecycle of the sBTC asset — Bitcoin-backed deposits and withdrawals against the sBTC protocol contracts, plus token transfers on the SIP-010 sbtc-token contract. It is the canonical reference for sBTC supply, flow, and per-address holdings on Stacks.

## Source

Decoded from canonical Stacks Streams events (L1) on two contracts:

- `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry` — emits all protocol-state print events listed below.
- `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` — SIP-010 ft_transfer / ft_mint / ft_burn events.

`sbtc-deposit` itself emits no print events; it routes deposits through `sbtc-registry`. Verified against the deployed mainnet contracts via Hiro's `/v2/contracts/source/...` endpoint.

The decoder filters print events on `sbtc-registry` (topic field is `topic`) and SIP-010 events on `sbtc-token`, normalizes Clarity-encoded payloads, and writes typed rows. All decoding happens via the L2 decoder pipeline at `packages/indexer/src/l2/decoders/sbtc.ts`.

## Layout

Object prefix (parquet — deferred to follow-up; v0 ships API-only):

```text
stacks-datasets/mainnet/v0/sbtc
```

For v0, consumers read via `/v1/datasets/sbtc/...`.

## Tables

### `sbtc_events`

Schema version: `0`. One row per decoded sBTC protocol event from `sbtc-registry`. Topic strings are kept verbatim (kebab-case) to match the on-chain print payloads.

| Column | Type | Nullable | Notes |
|---|---:|---:|---|
| `cursor` | string | no | `<block_height>:<event_index>` (PK) |
| `block_height` | int64 | no | Canonical Stacks block height |
| `block_time` | string | no | ISO-8601 UTC block timestamp |
| `tx_id` | string | no | Parent transaction id |
| `tx_index` | int32 | no | Parent transaction position in block |
| `event_index` | int32 | no | Streams event index in block |
| `topic` | string | no | One of: `completed-deposit` \| `withdrawal-create` \| `withdrawal-accept` \| `withdrawal-reject` \| `key-rotation` \| `update-protocol-contract` |
| `request_id` | int64 | yes | Withdrawal request id (set on `withdrawal-create` / `accept` / `reject`) |
| `amount` | string | yes | Amount in satoshis as decimal string (deposits + withdrawal-create) |
| `sender` | string | yes | Stacks principal initiating a withdrawal-create |
| `recipient_btc_version` | int32 | yes | Bitcoin address version byte (withdrawal-create recipient) |
| `recipient_btc_hashbytes` | string | yes | Hex hashbytes of the BTC recipient (withdrawal-create) |
| `bitcoin_txid` | string | yes | Bitcoin transaction id (deposit + withdrawal-accept) |
| `output_index` | int32 | yes | Bitcoin tx output index (deposit + withdrawal-accept) |
| `sweep_txid` | string | yes | Bitcoin sweep transaction id (deposit + withdrawal-accept) |
| `burn_hash` | string | yes | Bitcoin burn block hash (deposit + withdrawal-accept) |
| `burn_height` | int64 | yes | Bitcoin burn block height (deposit + withdrawal-accept) |
| `signer_bitmap` | string | yes | Bitmap of signers that approved/rejected (withdrawal-accept + withdrawal-reject) |
| `max_fee` | string | yes | Max BTC fee allowed (withdrawal-create) |
| `fee` | string | yes | Actual BTC fee charged (withdrawal-accept) |
| `block_height_at_request` | int64 | yes | Stacks block height recorded in the withdrawal-create payload |
| `governance_contract_type` | int32 | yes | Single-byte tag for `update-protocol-contract` events |
| `governance_new_contract` | string | yes | New protocol contract principal (`update-protocol-contract`) |
| `signer_aggregate_pubkey` | string | yes | New aggregate pubkey hex (`key-rotation`) |
| `signer_threshold` | int32 | yes | New signature threshold (`key-rotation`) |
| `signer_address` | string | yes | New signer-set bookkeeping principal (`key-rotation`) |
| `signer_keys_count` | int32 | yes | Number of keys in the rotated set (`key-rotation`) |
| `canonical` | boolean | no | False after the indexer marks the row's block as orphaned |
| `source_cursor` | string | no | The Streams cursor the row was decoded from |

Indexes:
- `(canonical, block_height)` — cursor scans
- `(topic, block_height)` — type-filtered queries
- `(request_id)` — withdrawal lifecycle joins
- `(bitcoin_txid)` — cross-chain joins
- `(sender, block_height)` — per-initiator history

### `sbtc_token_events`

Schema version: `0`. One row per SIP-010 event on `sbtc-token` (transfers, mints, burns).

| Column | Type | Nullable | Notes |
|---|---:|---:|---|
| `cursor` | string | no | PK |
| `block_height` | int64 | no | |
| `block_time` | string | no | |
| `tx_id` | string | no | |
| `tx_index` | int32 | no | |
| `event_index` | int32 | no | |
| `event_type` | string | no | `transfer` \| `mint` \| `burn` |
| `sender` | string | yes | Null on mint |
| `recipient` | string | yes | Null on burn |
| `amount` | string | no | Satoshis as decimal string |
| `memo` | string | yes | Hex if present |
| `canonical` | boolean | no | |
| `source_cursor` | string | no | |

### `sbtc_supply_snapshots`

Schema version: `0`. One row per UTC date capturing total sBTC supply at end-of-day. Computed by an aggregator job from the two event tables.

| Column | Type | Notes |
|---|---:|---|
| `date` | string | UTC `YYYY-MM-DD` (PK) |
| `total_supply` | string | Total supply in satoshis at end of day |
| `mints_today` | string | Sum of mint amounts on this date |
| `burns_today` | string | Sum of burn amounts on this date |
| `deposit_count` | int32 | Number of `completed-deposit` events |
| `withdrawal_create_count` | int32 | Number of `withdrawal-create` events |
| `withdrawal_accept_count` | int32 | Number of `withdrawal-accept` events |
| `withdrawal_reject_count` | int32 | Number of `withdrawal-reject` events |

The supply rollup runs as an aggregator tick alongside the decoder. May land in a follow-up if Stage 1 runs hot.

## API Row Shapes

### `GET /v1/datasets/sbtc/events`

Filters: `topic`, `request_id`, `bitcoin_txid`, `sender`, `from_block`, `to_block`. Pagination: `cursor`. Default scan window is one day of blocks unless `from_block` or `cursor` is supplied.

```json
{
  "events": [
    {
      "cursor": "7869999:42",
      "block_height": 7869999,
      "block_time": "2026-05-05T12:34:56.000Z",
      "tx_id": "0xabc...",
      "tx_index": 12,
      "event_index": 42,
      "topic": "completed-deposit",
      "amount": "100000000",
      "bitcoin_txid": "a1b2...",
      "output_index": 0,
      "sweep_txid": "c3d4...",
      "burn_hash": "e5f6...",
      "burn_height": 902481
    }
  ],
  "next_cursor": "7870001:7",
  "tip": { "block_height": 7879089 }
}
```

Fields not relevant to the topic are omitted from the JSON response (null on the wire is dropped server-side).

### `GET /v1/datasets/sbtc/token-events`

Filters: `event_type`, `sender`, `recipient`, `from_block`, `to_block`. SIP-010 transfers / mints / burns on `sbtc-token`.

### `GET /v1/datasets/sbtc/supply`

Daily rollup view.

## Freshness

`/public/status.datasets[]` includes a `sbtc-events` entry with `latest_finalized_cursor`, `generated_at`, `to_block`, and `lag_blocks` against the chain tip.

## Versioning

Schema changes ship under a new `version` (e.g., `v1`). v0 stays available until deprecated.

## Out of scope (v0)

- Parquet exporter — will mirror STX transfers when prioritized.
- Per-address point-in-time holdings projection.
- Pegging-out queue depth metrics derived from withdrawal lifecycle latencies.
- Decoding signer-set membership from `key-rotation` payloads (we capture aggregate state but not per-signer authorization metadata).
