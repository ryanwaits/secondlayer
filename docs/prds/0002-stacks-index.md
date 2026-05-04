# PRD 0002 - Stacks Index

**Status:** Draft -> In Build (Phase 1, week 2)
**Owner:** Ryan
**Last updated:** May 2026
**Related docs:** `ARCHITECTURE.md` §L2, `PRODUCTS.md` -> Stacks Index, `ROADMAP.md` Phase 1

---

## Summary

Stacks Index is the public read surface over L2 - decoded chain events. It starts with `ft_transfer` and `nft_transfer`, then expands across the same 11 event classes exposed by Stacks Streams.

Index is not a transaction API. It is not a custom view engine. Transactions stay indexer-internal. App-specific views belong in Stacks Subgraphs.

## Goals

1. Expose decoded transfer events without requiring customers to parse raw Streams payloads.
2. Mirror the Streams cursor and reorg envelope contract.
3. Keep storage extensible as the remaining event types land.
4. Ship paid auth, per-layer rate limits, SDK methods, docs, and status visibility.

## Non-goals

- GraphQL.
- Transaction-level endpoints.
- Webhooks or push delivery.
- Decoded JSON for NFT Clarity values in v1.
- Per-type physical tables.

## Audience

- App developers querying token and NFT movement.
- Dashboards and explorers.
- Internal Stacks Subgraphs and Subscriptions surfaces.

## API surface

Base path: `https://api.secondlayer.tools/v1/index`

### `GET /ft-transfers`

Returns decoded fungible token transfer events.

**Query parameters**

| Parameter | Type | Notes |
|---|---|---|
| `cursor` / `from_cursor` | string | `<block_height>:<event_index>` |
| `limit` | int | Default 200. Max 1000. |
| `contract_id` | string | Full contract principal, e.g. `SP...sbtc-token`. |
| `sender` | string | Principal. |
| `recipient` | string | Principal. |
| `from_height` | int | Inclusive. |
| `to_height` | int | Inclusive. |

```json
{
  "events": [
    {
      "cursor": "182431:14",
      "block_height": 182431,
      "tx_id": "0x...",
      "tx_index": 3,
      "event_index": 14,
      "event_type": "ft_transfer",
      "contract_id": "SP000...sbtc-token",
      "asset_identifier": "SP000...sbtc-token::sbtc",
      "sender": "SP...",
      "recipient": "SP...",
      "amount": "250000"
    }
  ],
  "next_cursor": "182431:15",
  "tip": { "block_height": 182447, "lag_seconds": 3 },
  "reorgs": []
}
```

### `GET /nft-transfers`

Returns decoded NFT transfer events.

**Query parameters**

| Parameter | Type | Notes |
|---|---|---|
| `cursor` / `from_cursor` | string | `<block_height>:<event_index>` |
| `limit` | int | Default 200. Max 1000. |
| `contract_id` | string | Full contract principal. |
| `sender` | string | Principal. |
| `recipient` | string | Principal. |
| `asset_identifier` | string | Full asset identifier. |
| `from_height` | int | Inclusive. |
| `to_height` | int | Inclusive. |

```json
{
  "events": [
    {
      "cursor": "182431:18",
      "block_height": 182431,
      "tx_id": "0x...",
      "tx_index": 3,
      "event_index": 18,
      "event_type": "nft_transfer",
      "contract_id": "SP000...collection",
      "asset_identifier": "SP000...collection::token",
      "sender": "SP...",
      "recipient": "SP...",
      "value": "0x..."
    }
  ],
  "next_cursor": "182431:19",
  "tip": { "block_height": 182447, "lag_seconds": 3 },
  "reorgs": []
}
```

`value` is the raw Clarity-serialized token identifier as a hex string. v1 does not decode it into JSON. v1.1 may add a decoded JSON form.

## Schema

One shared table: `decoded_events`. Endpoints are typed views over it.

| Column | Type | Populated for |
|---|---|---|
| `cursor` | text primary key | all |
| `block_height` | bigint | all |
| `tx_id` | text | all |
| `tx_index` | integer | all |
| `event_index` | integer | all |
| `event_type` | text | all |
| `microblock_hash` | text nullable | future microblock-aware decoders |
| `canonical` | boolean | all |
| `contract_id` | text nullable | contract events |
| `sender` | text nullable | transfer-like events |
| `recipient` | text nullable | transfer-like events |
| `amount` | text nullable | FT/STX amount events |
| `asset_identifier` | text nullable | FT/NFT events |
| `value` | text nullable | NFT token identifier, raw Clarity hex |
| `memo` | text nullable | events with memo-like fields |
| `source_cursor` | text | source Streams cursor |
| `created_at` | timestamp | all |

`contract_id` is always the full contract principal string. It is not split into address/name columns.

`amount` is stored as text and serialized as a JSON string. No bigint or number surface.

Required indexes:

- `decoded_events_contract_height_event_idx` on `(contract_id, block_height, event_index)`
- `decoded_events_sender_height_event_idx` on `(sender, block_height, event_index)`
- `decoded_events_recipient_height_event_idx` on `(recipient, block_height, event_index)`

## Cursor and reorg semantics

Cursor format is identical to Stacks Streams: `<block_height>:<event_index>`. No synthetic slots. No nulls. No leading zeros.

Every response includes top-level `reorgs: []`. When an L2 event is rolled back, its cursor appears in the affected reorg range exactly as L1 does. SDK reorg handling stays shared across layers.

## Auth and metering

- Bearer token auth.
- Required scope: `index:read`.
- Free tier is evaluation only.
- Build: 50 req/s for Index.
- Scale: 250 req/s for Index.
- Enterprise: custom.

Index rate limits use a separate bucket from Stacks Streams. Build gets 50 req/s on Streams and 50 req/s on Index. Scale gets 250 + 250.

Metered unit: decoded events returned.

## SDK and docs

- `client.index.ftTransfers.list({ ... })`
- `client.index.nftTransfers.list({ ... })`
- Async iterator helpers for full-history walks.
- Docs page covers filters, pagination, auth, reorg handling, and raw NFT `value` encoding.

## Status

Status page adds:

- L2 `ft_transfer` freshness.
- L2 `nft_transfer` freshness.

Use the same green/yellow/red lag logic as Stacks Streams tip.

## Acceptance criteria

1. `decoded_events` table matches the shared L2 schema above.
2. `ft_transfer` decoder writes flattened public columns.
3. `nft_transfer` schema path is available without another table migration.
4. `/v1/index/ft-transfers` is live behind paid auth.
5. `/v1/index/nft-transfers` is live behind paid auth.
6. SDK exposes typed list and iterator methods.
7. Docs and status page cover both endpoints.

## Open questions

- None for Task 1.

---

*This PRD is the contract for Phase 1 week 2 Stacks Index work. Update when scope changes.*
