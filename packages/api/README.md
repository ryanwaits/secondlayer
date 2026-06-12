# @secondlayer/api

REST API for Second Layer.

Base URL: `https://api.secondlayer.tools`

## Which API should I use?

| Need | Product | Base path |
|---|---|---|
| Raw ordered chain events | Stacks Streams | `/v1/streams` |
| Decoded token and NFT transfer events | Stacks Index | `/v1/index` |
| App-specific materialized tables | Stacks Subgraphs | `/v1/subgraphs` (reads — anon for public subgraphs, wildcard CORS) · `/api/subgraphs` (management) |

## Authentication

Product endpoints require a Bearer token:

```bash
curl -H "Authorization: Bearer sk-sl_..." \
  https://api.secondlayer.tools/v1/streams/tip
```

Get a session token via the CLI: `sl login`

## Stacks Streams

Read-only raw chain event feed. Cursors use `<block_height>:<event_index>`.

```
GET /v1/streams/events                         # cursor-paginated raw events
GET /v1/streams/events/:tx_id                  # events emitted by one tx
GET /v1/streams/blocks/:heightOrHash/events    # events in one block
GET /v1/streams/canonical/:height              # canonical block hash lookup
GET /v1/streams/reorgs?since=...&limit=...     # recorded reorg metadata
GET /v1/streams/tip                            # current tip and ingest lag
```

Every successful event response includes `{ events, tip, reorgs }`; paginated
responses also include `next_cursor`.

## Stacks Index

Decoded read layer — events, contract calls, transfers, blocks, transactions.

```
GET /v1/index/events
GET /v1/index/contract-calls
GET /v1/index/ft-transfers
GET /v1/index/nft-transfers
GET /v1/index/blocks
GET /v1/index/transactions
```

Both endpoints support `cursor`, `from_cursor`, `limit`, `from_height`,
`to_height`, `contract_id`, `sender`, and `recipient`. NFT transfers also
support `asset_identifier`.

Responses use the same envelope pattern as Stacks Streams:
`{ events, next_cursor, tip, reorgs }`.

### Transaction-inclusion proofs

```
GET /v1/index/transactions/:tx_id/proof
```

Returns a trustless proof that a transaction is included in a Stacks (Nakamoto)
block, and that the reward cycle's signers attested to that block. The proof is
self-verifying: a consumer recomputes everything client-side and trusts nothing
Second Layer returned. Open beta — no read auth.

```bash
curl https://api.secondlayer.tools/v1/index/transactions/0x.../proof
```

200 response:

```json
{
  "txid": "<hex>",
  "index_block_hash": "<hex>",
  "block_height": 8199502,
  "tx_index": 0,
  "raw_tx": "<hex>",
  "raw_header": "<hex>",
  "tx_merkle_path": [{ "position": "left", "hash": "<hex>" }],
  "consensus": {
    "reward_cycle": 136,
    "reward_set": {
      "signers": [{ "signing_key": "<hex>", "weight": 51 }],
      "total_weight": 3862
    }
  }
}
```

`consensus` is present only when the reward set could be resolved; otherwise the
proof is anchored-only (still verifiable as included in a corroborable header,
without the signer-weight check).

Verify the proof client-side with `verifyTransactionProof` from
[`@secondlayer/sdk`](../sdk/README.md). For a fully-trustless consensus check,
resolve the reward set from your own stacks-node rather than trusting the
embedded set.

Proof errors:

| Status | Code | Description |
|--------|------|-------------|
| 404 | `PROOF_UNAVAILABLE` | Transaction or block not found |
| 503 | `PROOF_TX_SET_INCOMPLETE` | Server couldn't reproduce the block's `tx_merkle_root` from its stored tx set, so it refuses to emit an unverifiable proof (fail-safe) |

## Stacks Subgraphs

Reads live on `/v1/subgraphs` — anon for **public** subgraphs (managed deploys
default public; BYO deploys default private), owner `sk-sl_` bearer for private
(anon → 404). Wildcard CORS.

```
GET /v1/subgraphs                       # list public (+ caller's own with bearer)
GET /v1/subgraphs/:name                 # metadata + tables + tip
GET /v1/subgraphs/:name/:table          # query rows
GET /v1/subgraphs/:name/:table/count
GET /v1/subgraphs/:name/:table/aggregate
GET /v1/subgraphs/:name/:table/:id
GET /v1/subgraphs/:name/:table/stream   # SSE
GET /v1/subgraphs/:name/openapi.json    # per-subgraph specs (anon for public)
GET /v1/subgraphs/:name/schema.json
GET /v1/subgraphs/:name/docs.md
```

Row routes return `{ rows, next_cursor, tip }` with `_id` keyset pagination —
pass `?cursor=<next_cursor>` to resume, `_order=asc|desc` for direction
(`_offset`/`_sort` rejected with 400). Visibility: deploy with
`--visibility public|private`, flip later with `sl subgraphs publish|unpublish`;
public names are a single global claim-on-publish namespace
(409 `PUBLIC_NAME_TAKEN`).

Management stays on `/api/subgraphs` (session or key):

```
GET    /api/subgraphs                # list
POST   /api/subgraphs                # deploy
GET    /api/subgraphs/:name          # get
DELETE /api/subgraphs/:name          # delete
POST   /api/subgraphs/:name/reindex  # reindex
POST   /api/subgraphs/:name/backfill # backfill a block range
POST   /api/subgraphs/:name/stop     # request operation cancellation
GET    /api/subgraphs/:name/source   # captured source for edit loops
GET    /api/subgraphs/:name/gaps     # gap inspection
GET    /api/subgraphs/:name/openapi.json # generated OpenAPI 3.1 spec
GET    /api/subgraphs/:name/schema.json  # compact agent schema
GET    /api/subgraphs/:name/docs.md      # generated Markdown reference
GET    /api/subgraphs/:name/:table   # query table
GET    /api/subgraphs/:name/:table/count
GET    /api/subgraphs/:name/:table/:id
```

Table list routes return `{ data, meta }`. Count routes return `{ count }`.

### Generated subgraph API specs

The API can generate documentation from the deployed subgraph schema. These
routes use the same authentication and ownership checks as
`GET /api/subgraphs/:name`.

```bash
curl -H "Authorization: Bearer sk-sl_..." \
  https://api.secondlayer.tools/api/subgraphs/token-transfers/openapi.json

curl -H "Authorization: Bearer sk-sl_..." \
  https://api.secondlayer.tools/api/subgraphs/token-transfers/schema.json

curl -H "Authorization: Bearer sk-sl_..." \
  https://api.secondlayer.tools/api/subgraphs/token-transfers/docs.md
```

Formats:

| Route | Format | Use |
|---|---|---|
| `/openapi.json` | OpenAPI 3.1 JSON | Docs systems, client generators, API catalogs |
| `/schema.json` | Compact JSON | Agent context with tables, columns, filters, endpoints, and static examples |
| `/docs.md` | Markdown | Human-readable API reference |

Pass `?server=<url>` to override the server URL embedded in generated docs.

## Subscriptions

Signed HTTP webhooks. Polymorphic — a subscription is either **subgraph** (fires
on a deployed subgraph table's rows) or **chain** (fires on raw chain events,
no subgraph; forward-looking — starts at the chain tip, never backfills).

```
GET    /api/subscriptions                       # list
POST   /api/subscriptions                       # create
GET    /api/subscriptions/:id                   # get
PATCH  /api/subscriptions/:id                   # update
DELETE /api/subscriptions/:id                   # delete
POST   /api/subscriptions/:id/pause             # pause
POST   /api/subscriptions/:id/resume            # resume
POST   /api/subscriptions/:id/rotate-secret     # rotate signing secret
GET    /api/subscriptions/:id/deliveries        # recent delivery attempts
GET    /api/subscriptions/:id/dead              # dead-letter outbox rows
POST   /api/subscriptions/:id/dead/:outboxId/requeue
POST   /api/subscriptions/:id/replay            # replay a block range
```

`POST /api/subscriptions` accepts a `triggers` array (1..50) for a **chain**
subscription, OR `subgraphName` + `tableName` for a **subgraph** subscription —
mutually exclusive.

```bash
curl -X POST -H "Authorization: Bearer sk-sl_..." \
  https://api.secondlayer.tools/api/subscriptions \
  -d '{
    "name": "amm-swaps",
    "url": "https://my-app.com/webhook",
    "triggers": [
      { "type": "contract_call", "contractId": "SP....amm", "functionName": "swap-*" },
      { "type": "ft_transfer", "trait": "sip-010", "minAmount": "1000000" }
    ]
  }'
```

Trigger types and their fields (all string fields accept `*` wildcards; `trait`
scopes to contracts conforming to a SIP/trait; amounts are non-negative integer
strings or numbers):

| `type` | Fields |
|---|---|
| `contract_call` | `contractId`, `functionName`, `caller`, `trait` |
| `contract_deploy` | `deployer`, `contractName` |
| `ft_transfer` / `ft_mint` / `ft_burn` | `assetIdentifier`, `sender`, `recipient`, `minAmount`, `trait` |
| `nft_transfer` / `nft_mint` / `nft_burn` | `assetIdentifier`, `sender`, `recipient`, `trait` |
| `stx_transfer` | `sender`, `recipient`, `minAmount`, `maxAmount` |
| `stx_mint` / `stx_burn` | `sender`, `recipient`, `minAmount` |
| `stx_lock` | `lockedAddress`, `minAmount` |
| `print_event` | `contractId`, `topic`, `trait` |

Chain delivery envelope: each apply is `chain.{type}.apply` with body
`{ action: "apply", block_hash, block_height, tx_id, canonical, trigger, event }`.
On reorg you get `chain.reorg.rollback` with `{ action: "rollback",
fork_point_height, orphaned: [{ tx_id, event }] }`. Delivery is at-least-once: a
tx surviving a reorg re-delivers an apply under its new `block_hash` — key
consumer state on `(tx_id, block_hash)`. Per-subscription HMAC signing (Standard
Webhooks) applies to both kinds.

## Error Codes

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid input |
| 401 | `AUTHENTICATION_ERROR` | Missing or invalid token |
| 403 | `AUTHORIZATION_ERROR` | Token valid but not authorized |
| 404 | `SUBGRAPH_NOT_FOUND` | Resource not found |
| 429 | `RATE_LIMIT_ERROR` | Rate limited |
| 500 | `INTERNAL_ERROR` | Server error |
