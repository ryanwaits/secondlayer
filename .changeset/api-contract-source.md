---
"@secondlayer/api": patch
---

`GET /v1/contracts/:id?include=source` returns the Clarity source a contract was deployed with, read from its deploy transaction. `include` takes a comma list (`abi,source`). `/v1/contracts` and `/v1/contracts/:id` are now in the OpenAPI spec.
