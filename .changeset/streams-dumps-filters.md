---
"@secondlayer/sdk": minor
"@secondlayer/mcp": minor
---

Streams discovery for agents. Thread a `dumpsBaseUrl` option through `SecondLayerOptions` → the streams client so `streams.dumps.*` works from the top-level SDK (MCP wires it from `SL_STREAMS_DUMPS_URL`). Add a `streams_dumps` MCP tool exposing the bulk parquet manifest (coverage, `latest_finalized_cursor`, per-file metadata + signed URLs) for cold backfill, and a `secondlayer://streams-filters` resource listing the firehose event types and the filter fields `streams_events`/`streams_consume` accept.
