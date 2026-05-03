# Stacks Streams Schema

Stacks Streams is L1: confirmed, canonical, chain-emitted events only.

## What Is An L1 Event

L1 event types are exactly those the chain natively emits. Platform-level signals such as reorg notifications, tip updates, and ingestion lag are response-envelope metadata, not events. Contract calls are transactions, not emitted events. If you need decoded contract calls — function name, arguments, ABI applied — use Stacks Index (L2). The clean separation is intentional: L1 is a faithful messenger; L2 adds semantics.

## Event Shape

```json
{
  "cursor": "182431:14",
  "block_height": 182431,
  "index_block_hash": "0x...",
  "burn_block_height": 871233,
  "tx_id": "0x...",
  "tx_index": 3,
  "event_index": 14,
  "event_type": "ft_transfer",
  "contract_id": "SP000...sbtc-token",
  "payload": {},
  "ts": "2026-05-02T21:43:00Z"
}
```

`index_block_hash` is the canonical pin. For a given `block_height`, it identifies the canonical Stacks block whose events are being served. Clients that mirror data compare it with `GET /v1/streams/canonical/{height}` and re-sync mismatched ranges.

## Cursor Contract

Cursor format is `<block_height>:<event_index>`. `event_index` is the Nth real chain-emitted event in a block, monotonic across all transactions in canonical transaction order, starting at 0. No synthetic slots. No nulls. No tagged unions. This is a 1.0 contract.

`tx_index` is the 0-indexed position of the parent transaction within the block. `tx_index` covers every transaction in canonical block order, including coinbase, 0-indexed. Use it to group events by transaction without adding synthetic records.

## Event Types

| Type | Source | Payload shape | Example |
|---|---|---|---|
| `stx_transfer` | core | `{ sender, recipient, amount, memo? }` | `{ "sender": "SP...", "recipient": "SP...", "amount": "1000" }` |
| `stx_mint` | core | `{ recipient, amount }` | `{ "recipient": "SP...", "amount": "5000" }` |
| `stx_burn` | core | `{ sender, amount }` | `{ "sender": "SP...", "amount": "1000" }` |
| `stx_lock` | core | `{ locked_amount, unlock_height, locked_address }` | `{ "locked_amount": "1000", "unlock_height": "200000", "locked_address": "SP..." }` |
| `ft_transfer` | SIP-010 | `{ asset_identifier, sender, recipient, amount }` | `{ "asset_identifier": "SP...token::sbtc", "sender": "SP...", "recipient": "SP...", "amount": "42" }` |
| `ft_mint` | SIP-010 | `{ asset_identifier, recipient, amount }` | `{ "asset_identifier": "SP...token::sbtc", "recipient": "SP...", "amount": "42" }` |
| `ft_burn` | SIP-010 | `{ asset_identifier, sender, amount }` | `{ "asset_identifier": "SP...token::sbtc", "sender": "SP...", "amount": "42" }` |
| `nft_transfer` | SIP-009 | `{ asset_identifier, sender, recipient, value: { hex, repr } }` | `{ "asset_identifier": "SP...nft::id", "sender": "SP...", "recipient": "SP...", "value": { "hex": "0x0100000000000000000000000000000001", "repr": "u1" } }` |
| `nft_mint` | SIP-009 | `{ asset_identifier, recipient, value: { hex, repr } }` | `{ "asset_identifier": "SP...nft::id", "recipient": "SP...", "value": { "hex": "0x0100000000000000000000000000000001", "repr": "u1" } }` |
| `nft_burn` | SIP-009 | `{ asset_identifier, sender, value: { hex, repr } }` | `{ "asset_identifier": "SP...nft::id", "sender": "SP...", "value": { "hex": "0x0100000000000000000000000000000001", "repr": "u1" } }` |
| `print` | core | `{ contract_id, topic, value }` | `{ "contract_id": "SP...contract", "topic": "print", "value": { "hex": "0x...", "repr": "(tuple ...)" } }` |

## Reorg Metadata

`GET /v1/streams/events` returns real events plus top-level reorg metadata:

```json
{
  "events": [],
  "next_cursor": "182431:15",
  "tip": { "block_height": 182447, "lag_seconds": 3 },
  "reorgs": [
    {
      "detected_at": "2026-05-03T12:30:00Z",
      "fork_point_height": 182428,
      "orphaned_range": { "from": "182428:0", "to": "182430:42" },
      "new_canonical_tip": "182430:38"
    }
  ]
}
```

`orphaned_range` is inclusive and uses normal event cursors. Inline `reorgs` contains records whose orphaned range overlaps the response range. `GET /v1/streams/reorgs?since=<timestamp_or_cursor>&limit=<n>` returns the same records ordered by `detected_at` ascending for audit and alerting.

Client loop: call `/events?cursor=<last>`, process events, invalidate local state for each `reorgs[].orphaned_range`, advance to `next_cursor`, repeat. Store processed event cursors and make writes idempotent by cursor.

## Worked Example

```json
{
  "cursor": "182431:14",
  "block_height": 182431,
  "index_block_hash": "0x8d7bece71b8b2ec71d102e7a95c0e3b4aaf55fb9e1df3b9844dc728d89b98e74",
  "burn_block_height": 871233,
  "tx_id": "0x5f2f3e7a0fbf18e4f6c22e4bbdb27d6c68c2dce2f8a34c0ef30c4c6d0a7a9b12",
  "tx_index": 2,
  "event_index": 14,
  "event_type": "ft_transfer",
  "contract_id": "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
  "payload": {
    "asset_identifier": "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc",
    "sender": "SP2C2YFP3X7QVRGQ08B7SK7M16B6AN7F7B0Z6YZER",
    "recipient": "SP1Q1D3K3V7W7W8YJ6RM62C6F2G5V8MEQ7J8D1R3H",
    "amount": "250000"
  },
  "ts": "2026-05-02T21:43:00Z"
}
```

NFT values use the same `{ hex, repr }` shape as print values:

```json
{
  "cursor": "182431:15",
  "block_height": 182431,
  "index_block_hash": "0x8d7bece71b8b2ec71d102e7a95c0e3b4aaf55fb9e1df3b9844dc728d89b98e74",
  "burn_block_height": 871233,
  "tx_id": "0x70bc8f5c8bd17f9b818c5ab9c5e87024b6d0efb8c6c3a905551a3e6d01f92db0",
  "tx_index": 3,
  "event_index": 15,
  "event_type": "nft_transfer",
  "contract_id": "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.example-nft",
  "payload": {
    "asset_identifier": "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.example-nft::token-id",
    "sender": "SP2C2YFP3X7QVRGQ08B7SK7M16B6AN7F7B0Z6YZER",
    "recipient": "SP1Q1D3K3V7W7W8YJ6RM62C6F2G5V8MEQ7J8D1R3H",
    "value": {
      "hex": "0x0100000000000000000000000000000001",
      "repr": "u1"
    }
  },
  "ts": "2026-05-02T21:43:00Z"
}
```
