---
"@secondlayer/api": minor
"@secondlayer/sdk": minor
"@secondlayer/mcp": minor
---

Let an agent read its own consumption and limits. `GET /v1/streams/usage` and `GET /v1/index/usage` return the account's events today + this month for that product plus its tier limits (Streams: rate limit + retention days; Index: rate limit), reusing the existing metering. Streams is key-mandatory; Index requires a Build+ key (anonymous → 401). Surfaced as `sl.streams.usage()` / `sl.index.usage()` (SDK) and the `streams_usage` / `index_usage` MCP tools, and listed in the `/v1/streams` and `/v1/index` discovery routes.
