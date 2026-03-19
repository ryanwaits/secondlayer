# @secondlayer/api

REST API for Second Layer — streams and subgraphs.

Base URL: `https://api.secondlayer.tools`

## Authentication

All endpoints require a Bearer token (session token or API key):

```bash
curl -H "Authorization: Bearer ss-sl_..." https://api.secondlayer.tools/api/streams
```

Get a session token via the CLI: `sl auth login`

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
