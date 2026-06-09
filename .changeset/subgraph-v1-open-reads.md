---
"@secondlayer/shared": minor
"@secondlayer/sdk": minor
"@secondlayer/cli": minor
"@secondlayer/mcp": minor
---

Subgraph visibility + open /v1 read surface. New managed deploys default `public` — anon-readable at `/v1/subgraphs/:name/:table` with the standard cursor envelope (`{ rows, next_cursor, tip }`), wildcard CORS, and anon rate limits; BYO-database deploys default `private` (reads require the owning account's `sk-sl_` key; anon resolution 404s). Public names are a single global namespace claimed on publish (409 `PUBLIC_NAME_TAKEN` on collision). CLI: `sl subgraphs deploy --visibility`, `sl subgraphs publish|unpublish`. SDK: `subgraphs.publish()/unpublish()/rows()`. MCP: `visibility` on `subgraphs_deploy`, new `subgraphs_publish`/`subgraphs_unpublish` tools. Shared: `subgraphs.visibility` column (migration 0092), deploy schema field, `PUBLIC_NAME_TAKEN` error code.
