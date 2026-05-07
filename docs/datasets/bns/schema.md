# BNS Dataset Schema

Status: v0 contract.

The BNS dataset captures every name- and namespace-lifecycle event on Stacks BNS-V2, plus marketplace listings on the BNS-V2 NFT, plus a current-state projection answering "who owns `alice.btc` right now?" It is the canonical reference for BNS analytics and resolution at scale.

## Source

Decoded from canonical print events on the BNS-V2 contract:

- `SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2` (mainnet, contract name is uppercase)
- `ST2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2` (testnet)

The BNS-V2 contract uses **three different discriminator keys** in its print payloads — verified against the deployed mainnet source via Hiro:

| Discriminator key | Meaning |
|---|---|
| `topic` | Name-lifecycle events (`new-name`, `transfer-name`, `renew-name`, `burn-name`, `new-airdrop`) |
| `status` | Namespace-lifecycle events (`launch`, `transfer-manager`, `freeze-manager`, `update-price-manager`, `freeze-price-manager`, `turn-off-manager-transfers`) |
| `a` | Marketplace events (`list-in-ustx`, `unlist-in-ustx`, `buy-in-ustx`) |

The decoder dispatches on which key is present, normalizes each shape, and writes typed rows. All decoding happens in `packages/indexer/src/l2/decoders/bns.ts`. **v0 ships BNS-V2 only.** V1 historical names are out of scope.

## Layout

Parquet exporter is deferred for v0 (API-only).

## Tables

### `bns_name_events`

Schema version: `0`. One row per name-lifecycle event (the `topic`-discriminated payloads).

| Column | Type | Nullable | Notes |
|---|---:|---:|---|
| `cursor` | string | no | `<block_height>:<event_index>` (PK) |
| `block_height` | int64 | no | Canonical Stacks block height |
| `block_time` | string | no | ISO-8601 UTC block timestamp |
| `tx_id` | string | no | Parent transaction id |
| `tx_index` | int32 | no | Parent transaction position in block |
| `event_index` | int32 | no | Streams event index in block |
| `topic` | string | no | `new-name` \| `transfer-name` \| `renew-name` \| `burn-name` \| `new-airdrop` |
| `namespace` | string | no | Namespace label (UTF-8 decoded from `(buff 20)`) |
| `name` | string | no | Name label (UTF-8 decoded from `(buff 48)`) |
| `fqn` | string | no | `name.namespace` |
| `owner` | string | yes | Stacks principal owning the name after this event (empty string on `burn-name`) |
| `bns_id` | string | no | uint128 BNS-V2 NFT token id (decimal string) |
| `registered_at` | int64 | yes | From `properties.registered-at` (or top-level for `new-airdrop`) |
| `imported_at` | int64 | yes | From `properties.imported-at` |
| `renewal_height` | int64 | yes | From `properties.renewal-height` |
| `stx_burn` | string | yes | Cumulative STX burn from `properties.stx-burn` (microSTX decimal) |
| `preordered_by` | string | yes | Original preorder principal (`properties.preordered-by`) |
| `hashed_salted_fqn_preorder` | string | yes | Hex of `properties.hashed-salted-fqn-preorder` |
| `canonical` | boolean | no | False after the row's block is orphaned |
| `source_cursor` | string | no | Streams cursor the row was decoded from |

Indexes:
- `(canonical, block_height)` — cursor scans
- `(namespace, name)` — FQN lookups
- `(owner, block_height)` — per-address holdings
- `(topic, block_height)` — type-filtered queries
- `(bns_id)` — NFT id joins

### `bns_namespace_events`

Schema version: `0`. One row per namespace-lifecycle event (the `status`-discriminated payloads).

| Column | Type | Nullable | Notes |
|---|---:|---:|---|
| `cursor` | string | no | PK |
| `block_height` | int64 | no | |
| `block_time` | string | no | |
| `tx_id` | string | no | |
| `tx_index` | int32 | no | |
| `event_index` | int32 | no | |
| `status` | string | no | `launch` \| `transfer-manager` \| `freeze-manager` \| `update-price-manager` \| `freeze-price-manager` \| `turn-off-manager-transfers` |
| `namespace` | string | no | |
| `manager` | string | yes | Current namespace manager principal (from `properties.namespace-manager`) |
| `manager_frozen` | boolean | yes | From `properties.manager-frozen` |
| `manager_transfers_disabled` | boolean | yes | From `properties.manager-transfers` (inverted) |
| `price_function` | string | yes | Stable JSON encoding of `properties.price-function` (base + buckets + coeff + no-vowel-discount + non-alpha-discount) |
| `price_frozen` | boolean | yes | From `properties.price-frozen` |
| `lifetime` | int64 | yes | From `properties.lifetime` (renewal duration in blocks) |
| `revealed_at` | int64 | yes | From `properties.revealed-at` |
| `launched_at` | int64 | yes | From `properties.launched-at` |
| `canonical` | boolean | no | |
| `source_cursor` | string | no | |

Indexes:
- `(canonical, block_height)`
- `(namespace, status)`

### `bns_marketplace_events`

Schema version: `0`. One row per BNS-V2 NFT marketplace event (the `a`-discriminated payloads).

| Column | Type | Nullable | Notes |
|---|---:|---:|---|
| `cursor` | string | no | PK |
| `block_height` | int64 | no | |
| `block_time` | string | no | |
| `tx_id` | string | no | |
| `tx_index` | int32 | no | |
| `event_index` | int32 | no | |
| `action` | string | no | `list-in-ustx` \| `unlist-in-ustx` \| `buy-in-ustx` |
| `bns_id` | string | no | uint128 token id |
| `price_ustx` | string | yes | Listing price in microSTX (set on `list-in-ustx`) |
| `commission` | string | yes | Commission contract principal |
| `canonical` | boolean | no | |
| `source_cursor` | string | no | |

Indexes:
- `(canonical, block_height)`
- `(bns_id)` — listing history per name

### `bns_names` (current-state projection)

Schema version: `0`. One row per fully-qualified name reflecting the latest canonical state. Maintained by the decoder via upsert: each new name event for an FQN updates this row; `burn-name` deletes it.

| Column | Type | Nullable | Notes |
|---|---:|---:|---|
| `fqn` | string | no | PK |
| `namespace` | string | no | |
| `name` | string | no | |
| `owner` | string | no | Current owner Stacks principal |
| `bns_id` | string | no | uint128 BNS-V2 token id |
| `registered_at` | int64 | yes | First-registration block (from `new-name` properties) |
| `renewal_height` | int64 | yes | Current renewal height |
| `last_event_cursor` | string | no | Cursor of the most recent name-event affecting this row |
| `last_event_at` | string | no | ISO-8601 timestamp of last event |

Indexes:
- `(owner)` — per-address listings
- `(namespace, registered_at)` — namespace-scoped time queries
- `(renewal_height)` — expiration filtering

### `bns_namespaces` (current-state projection)

Schema version: `0`. One row per launched namespace; updated on `launch` / `transfer-manager` / etc.

| Column | Type | Notes |
|---|---:|---|
| `namespace` | string | PK |
| `manager` | string | Current namespace manager (nullable for unmanaged) |
| `manager_frozen` | boolean | Latest |
| `price_frozen` | boolean | Latest |
| `lifetime` | int64 | Latest renewal duration |
| `launched_at` | int64 | First `launch` block |
| `last_event_cursor` | string | |
| `last_event_at` | string | |
| `name_count` | int32 | Current count of names from `bns_names` (eventually consistent) |

## API Row Shapes

### `GET /v1/datasets/bns/name-events`

Filters: `topic`, `namespace`, `name`, `owner`, `from_block`, `to_block`. Pagination: `cursor`.

### `GET /v1/datasets/bns/namespace-events`

Filters: `status`, `namespace`, `from_block`, `to_block`. Pagination: `cursor`.

### `GET /v1/datasets/bns/marketplace-events`

Filters: `action`, `bns_id`, `from_block`, `to_block`. Pagination: `cursor`.

### `GET /v1/datasets/bns/names`

Filters: `namespace`, `owner`. Returns current-state rows from `bns_names`.

### `GET /v1/datasets/bns/namespaces`

Returns namespaces with their current managers + name counts.

### `GET /v1/datasets/bns/resolve?fqn=alice.btc`

Single-row lookup against `bns_names`:

```json
{
  "fqn": "alice.btc",
  "namespace": "btc",
  "name": "alice",
  "owner": "SP1...",
  "bns_id": "12345",
  "registered_at": 7869999,
  "renewal_height": 7919999,
  "last_event_at": "2026-05-05T12:34:56.000Z"
}
```

Returns 404 if no canonical row exists.

## Freshness

`/public/status.datasets[]` includes `bns-name-events` reporting decoder lag and last cursor.

## Versioning

Schema changes ship under a new `version`. v0 stays available until deprecated.

## Out of scope (v0)

- Parquet exporter (deferred to follow-up).
- BNS-V1 historical data.
- Zonefile resolution — BNS-V2 doesn't store zonefiles directly; resolution requires a separate resolver contract.
- Reverse resolution (principal → primary FQN) — depends on `set-primary-name` semantics; the contract has the function but no print is emitted, so a tx-result decoder would be needed (deferred).
- Subdomain registrations.
