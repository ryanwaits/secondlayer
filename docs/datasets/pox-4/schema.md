# PoX-4 Stacking Dataset Schema

Status: v0 contract.

The PoX-4 dataset captures every Stacking lifecycle event on Stacks — solo stacking, delegation, extension, increase, revocation, and aggregation — plus per-cycle and per-signer rollups. It is the canonical reference for "who is stacking, how much, in which cycle, with what BTC payout address, and which signer key."

## Source — important

**The PoX-4 contract emits zero `(print ...)` events.** State changes are encoded in `(ok ...)` response tuples returned from contract function calls; nothing is printed.

This means the standard print-event decoder pattern (used by FT/NFT/sBTC/BNS) does **not** apply. The PoX-4 decoder is a **transaction-result decoder**:

- Source: rows in the indexer's `transactions` table where `contract_id = SP000000000000000000002Q6VF78.pox-4` and the tx is canonical + status = `success`.
- Per supported function (`stack-stx`, `delegate-stx`, `stack-extend`, `stack-increase`, `revoke-delegate-stx`, `delegate-stack-stx`, `delegate-stack-extend`, `delegate-stack-increase`, `stack-aggregation-commit`, `stack-aggregation-commit-indexed`, `stack-aggregation-increase`, `set-signer-key-authorization`), the decoder reads `function_args` and `raw_result`, deserializes via `readCV` from `packages/stacks/src/clarity/deserialize.ts`, and writes typed rows.
- Reuses `parseBtcAddress()` from `packages/stacks/src/pox/utils.ts:47-164` for pox-addr decoding and `burnHeightToRewardCycle()` for cycle assignment.
- Lives at `packages/indexer/src/l2/decoders/pox-4.ts`. Unlike print-event decoders, it consumes from the indexer's local `transactions` table (no streams API call).

Mainnet contract: `SP000000000000000000002Q6VF78.pox-4`. Testnet: `ST000000000000000000002AMW42H.pox-4`.

## Layout

Parquet exporter is deferred for v0 (API-only). For v0, consumers read via `/v1/datasets/pox-4/...`.

## Tables

### `pox4_calls`

Schema version: `0`. One row per successful canonical PoX-4 contract call. Wide schema; columns not relevant to a given function are null.

| Column | Type | Nullable | Notes |
|---|---:|---:|---|
| `cursor` | string | no | `<block_height>:<tx_index>` (PK; tx-grain, not event-grain) |
| `block_height` | int64 | no | Canonical Stacks block height |
| `block_time` | string | no | ISO-8601 UTC block timestamp |
| `burn_block_height` | int64 | no | Bitcoin burn block height (for cycle math) |
| `tx_id` | string | no | Transaction id |
| `tx_index` | int32 | no | Transaction position in block |
| `function_name` | string | no | Discriminator: `stack-stx` \| `delegate-stx` \| `stack-extend` \| `stack-increase` \| `revoke-delegate-stx` \| `delegate-stack-stx` \| `delegate-stack-extend` \| `delegate-stack-increase` \| `stack-aggregation-commit` \| `stack-aggregation-commit-indexed` \| `stack-aggregation-increase` \| `set-signer-key-authorization` |
| `caller` | string | no | `tx-sender` for the call |
| `stacker` | string | yes | Effective stacker principal (== caller for solo, distinct for delegated-* functions) |
| `delegate_to` | string | yes | Pool principal for `delegate-stx`; null otherwise |
| `amount_ustx` | string | yes | Locked / increased / delegated amount (microSTX) |
| `lock_period` | int32 | yes | Number of reward cycles locked / extended |
| `pox_addr_version` | int32 | yes | BTC address version byte |
| `pox_addr_hashbytes` | string | yes | Hex hashbytes |
| `pox_addr_btc` | string | yes | Decoded BTC address (Bech32 / Bech32m / base58check) |
| `start_cycle` | int32 | yes | First reward cycle the position is active |
| `end_cycle` | int32 | yes | Last reward cycle the position is active |
| `signer_key` | string | yes | Hex signer pubkey (Nakamoto: required on `stack-stx`/`stack-extend`/`stack-increase`/`stack-aggregation-commit`) |
| `signer_signature` | string | yes | Hex signer signature when present |
| `auth_id` | string | yes | uint128 auth-id from the signer authorization (decimal string) |
| `max_amount` | string | yes | Max amount the signer authorized (microSTX) |
| `reward_cycle` | int32 | yes | Reward cycle the call targets (commit / increase / authorize) |
| `aggregated_amount_ustx` | string | yes | Total amount aggregated (`stack-aggregation-commit*`) |
| `aggregated_signer_index` | int32 | yes | Signer-slot index returned by `*-indexed` |
| `auth_period` | int32 | yes | Period for `set-signer-key-authorization` |
| `auth_topic` | string | yes | Topic string for `set-signer-key-authorization` (e.g. `stack-stx`) |
| `auth_allowed` | boolean | yes | Whether the authorization is granted (true) or revoked (false) |
| `result_ok` | boolean | no | True if the contract returned `(ok ...)`, false on `(err ...)` |
| `result_raw` | string | no | Hex-encoded Clarity-serialized response |
| `canonical` | boolean | no | False after the row's block is orphaned |

Indexes:
- `(canonical, block_height)` — cursor scans
- `(stacker, block_height)` — per-stacker history
- `(delegate_to, block_height)` — pool-level views
- `(signer_key, block_height)` — per-signer history
- `(reward_cycle, function_name)` — cycle-targeted queries
- `(start_cycle, end_cycle)` — cycle-membership queries
- `(function_name, block_height)` — function-filtered queries

Note: PK is `(block_height, tx_index)` rather than `(block_height, event_index)` because PoX-4 is tx-grain (one row per call), not event-grain.

### `pox4_cycles_daily`

Schema version: `0`. Daily snapshot per (date, reward_cycle) of stacking participation. Same shape as previous draft — stays useful as an aggregation target derived from `pox4_calls`.

| Column | Type | Notes |
|---|---:|---|
| `date` | string | UTC `YYYY-MM-DD` |
| `reward_cycle` | int32 | PoX reward cycle |
| `total_stacked_ustx` | string | Sum of currently-locked amounts (microSTX) |
| `solo_stackers` | int32 | Distinct stackers with `delegate_to IS NULL` and an active position |
| `delegated_principals` | int32 | Distinct principals with active delegations |
| `unique_pools` | int32 | Distinct `delegate_to` values across active delegations |
| `unique_signers` | int32 | Distinct `signer_key` values referenced by active positions |
| `calls_today` | int32 | Number of `pox4_calls` rows on this date affecting this cycle |

PK: `(date, reward_cycle)`.

### `pox4_signers_daily`

Schema version: `0`. Daily per-signer participation rollup.

| Column | Type | Notes |
|---|---:|---|
| `date` | string | UTC `YYYY-MM-DD` |
| `reward_cycle` | int32 | |
| `signer_key` | string | Hex signer pubkey |
| `weight_ustx` | string | Weight delegated/aggregated to this signer (microSTX) |
| `stacker_count` | int32 | Distinct stackers signaling this signer |
| `aggregation_calls` | int32 | Count of `stack-aggregation-commit*` calls referencing this signer |

PK: `(date, reward_cycle, signer_key)`.

The aggregators run as scheduler ticks in the indexer process, gated on `POX4_AGGREGATOR_ENABLED=true`. They derive from `pox4_calls` and recompute the trailing 7 days on each tick to absorb late-arriving rows.

## API Row Shapes

### `GET /v1/datasets/pox-4/calls`

Filters: `stacker`, `delegate_to`, `signer_key`, `function_name`, `reward_cycle`, `from_block`, `to_block`. Pagination: `cursor`.

```json
{
  "calls": [
    {
      "cursor": "7869999:4",
      "block_height": 7869999,
      "block_time": "2026-05-05T12:34:56.000Z",
      "burn_block_height": 902481,
      "tx_id": "0xabc...",
      "tx_index": 4,
      "function_name": "stack-stx",
      "caller": "SP1...",
      "stacker": "SP1...",
      "amount_ustx": "100000000000",
      "lock_period": 6,
      "pox_addr_version": 4,
      "pox_addr_hashbytes": "0x000102...",
      "pox_addr_btc": "bc1q...",
      "start_cycle": 87,
      "end_cycle": 92,
      "signer_key": "03ab...",
      "result_ok": true
    }
  ],
  "next_cursor": "7870001:0",
  "tip": { "block_height": 7879089 }
}
```

### `GET /v1/datasets/pox-4/cycles`

Filters: `reward_cycle`, `from_date`, `to_date`. Daily snapshots.

### `GET /v1/datasets/pox-4/signers`

Filters: `reward_cycle`, `signer_key`, `from_date`, `to_date`.

## Freshness

`/public/status.datasets[]` includes `pox-4-calls` reporting decoder lag and last cursor.

## Versioning

Schema changes ship under a new `version`. v0 stays available until deprecated.

## Out of scope (v0)

- Parquet exporter (deferred to follow-up).
- Pre-Nakamoto PoX (PoX-1/2/3) historical data — separate decoders required.
- Per-block reward distribution (BTC payouts) — needs Bitcoin-side data not yet ingested.
- Aggregator backfill of historical cycles — runs forward-only (see [#37](https://github.com/ryanwaits/secondlayer/issues/37)).
- Failed-call analytics: the dataset captures `result_ok = false` rows but doesn't decode the error tuple.
