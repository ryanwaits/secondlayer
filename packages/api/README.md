# @secondlayer/api

REST API for Second Layer.

Base URL: `https://api.secondlayer.tools`

## Which API should I use?

| Need | Product | Base path |
|---|---|---|
| Raw ordered chain events | Stacks Streams | `/v1/streams` |
| Decoded token and NFT transfer events | Stacks Index | `/v1/index` |
| App-specific materialized tables | Stacks Subgraphs | `/api/subgraphs` |

## Authentication

Product endpoints require a Bearer token:

```bash
curl -H "Authorization: Bearer sk-sl_..." \
  https://api.secondlayer.tools/v1/streams/tip
```

Get a session token via the CLI: `sl login`

## Stacks Streams

Read-only L1 event feed. Cursors use `<block_height>:<event_index>`.

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

L2 decoded events. v1 is intentionally limited to transfer endpoints.

```
GET /v1/index/ft-transfers
GET /v1/index/nft-transfers
```

Both endpoints support `cursor`, `from_cursor`, `limit`, `from_height`,
`to_height`, `contract_id`, `sender`, and `recipient`. NFT transfers also
support `asset_identifier`.

Responses use the same envelope pattern as Stacks Streams:
`{ events, next_cursor, tip, reorgs }`.

## Stacks Subgraphs

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

Per-row HTTP webhooks from subgraph tables.

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

## Error Codes

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid input |
| 401 | `AUTHENTICATION_ERROR` | Missing or invalid token |
| 403 | `AUTHORIZATION_ERROR` | Token valid but not authorized |
| 404 | `SUBGRAPH_NOT_FOUND` | Resource not found |
| 429 | `RATE_LIMIT_ERROR` | Rate limited |
| 500 | `INTERNAL_ERROR` | Server error |
