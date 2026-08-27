# `/extended` OpenAPI pin

Pinned upstream: **hirosystems/stacks-blockchain-api `v9.0.2`**

Source:
https://raw.githubusercontent.com/hirosystems/stacks-blockchain-api/v9.0.2/openapi.yaml

Subset file: `v9.0.2-subset.yaml` — only the 13 GET routes
`createExtendedApp` registers (excluding `/extended` discovery).

`/v1/openapi.json` stays our envelope. Do not merge these paths into it.

## Upstream path mapping (v9.0.2)

Classic `/extended/v1/*` routes we serve are largely **gone** from the
v9.0.2 document. Closest upstream siblings:

| Our path | Upstream v9.0.2 sibling |
|----------|-------------------------|
| `/extended/v1/status` | `GET /extended` (Api Status Response) |
| `/extended/v1/block` | `/extended/v2/blocks/` |
| `/extended/v1/block/{hash}` | `/extended/v2/blocks/{height_or_hash}` |
| `/extended/v1/tx` | `/extended/v3/transactions` |
| `/extended/v1/tx/{tx_id}` | `/extended/v3/transactions/{tx_id}` |
| `/extended/v1/tx/{tx_id}/events` | `/extended/v3/transactions/{tx_id}/events` (paged; we return a bare array) |
| `/extended/v1/address/{principal}/transactions` | `/extended/v3/principals/{principal}/transactions` |
| `/extended/v1/address/{principal}/stx` | `/extended/v3/principals/{principal}/balances/stx` (different shape) |
| `/extended/v1/address/{principal}/ft` | Not in upstream as this path; our projection of decoded holdings. Closest: `/extended/v3/principals/{principal}/balances/ft` |
| `/extended/v1/address/{principal}/nft` | Not in upstream as this path; our projection of decoded holdings. Closest: `/extended/v3/principals/{principal}/balances/nft` |
| `/extended/v1/names` | Not under `/extended`; BNS lives at `/v1/names/` (string array, not our list envelope) |
| `/extended/v1/names/{name}` | `/v1/names/{name}` (zonefile-centric BNS-V1 shape) |
| `/extended/v1/tokens/nft/transfers` | Not in upstream as this path; closest: `/extended/v1/tokens/nft/history` / `mints` |

## Deliberately not required (we do not persist this)

Honesty log — fields that are `required` on the closest upstream schema
(or classic Hiro wire shape still embedded in v9.0.2) but **omitted**
from our subset `required` (and usually from properties entirely):

### Status (`GET /extended`)

- `chain_tip.microblock_hash`, `chain_tip.microblock_sequence`
- `chain_tip.index_block_hash` as non-null string — we allow `null`

### Block (closest: `/extended/v2/blocks*`)

- `miner_txid`
- `execution_cost_read_count`, `execution_cost_read_length`,
  `execution_cost_runtime`, `execution_cost_write_count`,
  `execution_cost_write_length`
- `block_time`, `block_time_iso`, `tenure_height`
- List envelope: `next_cursor`, `prev_cursor`, `cursor`
- List items: `tx_count` (single GET only)
- Single GET: `txs` is ours; upstream v2 single block has no `txs` array
  in the documented schema snippet we track (tx_count only)

### Transaction (classic `TokenTransferTransaction` still inlined in v9)

- `nonce`, `fee_rate`, `sponsored`, `post_condition_mode`, `anchor_mode`
  when raw_tx does not decode (optional enrichment only)
- `post_conditions` (shape mismatch — never ship)
- `block_time`, `block_time_iso`, `burn_block_height`,
  `burn_block_time_iso`, `parent_burn_block_time`,
  `parent_burn_block_time_iso`, `parent_block_hash`
- `tx_result`, `event_count`, `events`
- `is_unanchored`, `microblock_hash`, `microblock_sequence`,
  `microblock_canonical`
- `execution_cost_*`, `vm_error`
- List envelope: no `next_cursor` / cursor object — `{ limit, offset, total, results }` only

### Tx events

- Upstream v3 returns a paged `{ total, limit, cursor, results }` object;
  we return a **JSON array**
- Classic event hex/repr payloads we do not persist
- `stx_lock` as a distinct Hiro event type — we map to `stx_asset` without
  inventing `asset_event_type: "lock"`

### STX totals

- Classic kitchen-sink: `nonce`, `total_fees_sent`
- Upstream v3 `PrincipalStxBalance`: `available`, nested `locked` object,
  `mempool` — we keep classic flat `{ balance, total_sent, total_received }`
  plus optional `locked` / `lock_tx_id` / `unlock_height` strings

### FT / NFT holdings

- Not in upstream as `/address/{}/ft` or `/nft`
- Do not invent Hiro `/balances` kitchen sink
- NFT `value` is our decoded string token id — not `{ hex, repr }`

### BNS

- Upstream `/v1/names*` zonefile / `address` / `blockchain` / `status` /
  `last_txid` / `zonefile_hash` fields — we project decoder columns only
- Decoder-off: list → empty `results`; single → `{}` (200, not 404)

### NFT transfers

- Hiro history/mints often require `{ hex, repr }` value objects and may
  embed full tx metadata — we ship string `value` + `tx_id` only
- `asset_event_type` fixed to `"transfer"` (nft_transfer rows only)
