# @secondlayer/api

REST API for Second Layer — subgraphs and workflows.

Base URL: `https://api.secondlayer.tools`

## Authentication

All endpoints require a Bearer token (session token or API key):

```bash
curl -H "Authorization: Bearer ss-sl_..." https://api.secondlayer.tools/api/subgraphs
```

Get a session token via the CLI: `sl auth login`

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
| 404 | `SUBGRAPH_NOT_FOUND` | Resource not found |
| 429 | `RATE_LIMIT_ERROR` | Rate limited |
| 500 | `INTERNAL_ERROR` | Server error |
