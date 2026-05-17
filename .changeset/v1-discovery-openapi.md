---
"@secondlayer/api": minor
---

`/v1` discovery surface — `GET /v1` returns surface index (datasets, index, streams). `GET /v1/datasets`, `/v1/streams`, `/v1/index` each return route + filter inventory. Hand-authored OpenAPI 3.1 spec at `/v1/openapi.json` covering all public surfaces (datasets, index, streams). Adds a friendly `/api/subgraphs/<name>/openapi → openapi.json` redirect (was previously matched as a table name and returned 404 TABLE_NOT_FOUND).
