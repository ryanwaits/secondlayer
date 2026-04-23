# @secondlayer/api

REST API for Second Layer — subgraphs and subscriptions.

Base URL: `https://api.secondlayer.tools`

## Authentication

All endpoints require a Bearer token (session token or API key):

```bash
curl -H "Authorization: Bearer ss-sl_..." https://api.secondlayer.tools/api/subgraphs
```

Get a session token via the CLI: `sl login`

## Subgraphs

```
GET    /api/subgraphs                # list
POST   /api/subgraphs                # deploy
GET    /api/subgraphs/:name          # get
DELETE /api/subgraphs/:name          # delete
POST   /api/subgraphs/:name/reindex  # reindex
GET    /api/subgraphs/:name/:table   # query table
```

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
