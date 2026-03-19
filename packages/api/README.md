# @secondlayer/api

REST API for Second Layer — streams, subgraphs, and contract discovery.

Base URL: `https://api.secondlayer.tools`

## Authentication

All endpoints require a Bearer token (session token or API key):

```bash
curl -H "Authorization: Bearer ss-sl_..." https://api.secondlayer.tools/api/contracts?q=bns
```

Get a session token via the CLI: `sl auth login`

## Contracts

### Search

```
GET /api/contracts?q=<query>&limit=20&offset=0
```

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `q` | yes | — | Search term (matches name and contract_id via ILIKE) |
| `limit` | no | 20 | Max results (1-100) |
| `offset` | no | 0 | Pagination offset |

Response:
```json
{
  "contracts": [
    {
      "contractId": "SP000000000000000000002Q6VF78.pox",
      "name": "pox",
      "deployer": "SP000000000000000000002Q6VF78",
      "deployBlock": 0,
      "callCount": 20,
      "lastCalledAt": "2026-03-09T19:56:12.000Z",
      "createdAt": "2026-03-09T18:00:00.000Z"
    }
  ],
  "total": 1
}
```

### Get Contract

```
GET /api/contracts/:contractId
```

Returns `ContractDetail` (summary + `deployTxId`, `abi`, `updatedAt`). 404 if not found.

### Get ABI

```
GET /api/contracts/:contractId/abi
GET /api/contracts/:contractId/abi?refresh=true
```

Returns the contract's Clarity ABI as JSON. On first request, fetches from the Stacks node and caches in the database. Subsequent requests serve from cache. Pass `?refresh=true` to force re-fetch (useful for upgraded contracts).

## Streams

```
GET    /api/streams              # list (paginated)
POST   /api/streams              # create
GET    /api/streams/:id          # get
PATCH  /api/streams/:id          # update
DELETE /api/streams/:id          # delete
POST   /api/streams/:id/enable   # enable
POST   /api/streams/:id/disable  # disable
POST   /api/streams/:id/replay   # replay block range
```

## Subgraphs

```
GET    /api/subgraphs                # list
POST   /api/subgraphs                # deploy
GET    /api/subgraphs/:name          # get
DELETE /api/subgraphs/:name          # delete
POST   /api/subgraphs/:name/reindex  # reindex
GET    /api/subgraphs/:name/:table   # query table
```

## Error Codes

| Status | Code | Description |
|--------|------|-------------|
| 400 | `VALIDATION_ERROR` | Invalid input |
| 401 | `AUTHENTICATION_ERROR` | Missing or invalid token |
| 403 | `AUTHORIZATION_ERROR` | Token valid but not authorized |
| 404 | `STREAM_NOT_FOUND` / `SUBGRAPH_NOT_FOUND` | Resource not found |
| 429 | `RATE_LIMIT_ERROR` | Rate limited |
| 500 | `INTERNAL_ERROR` | Server error |
