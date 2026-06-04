---
"@secondlayer/shared": minor
"@secondlayer/sdk": patch
"@secondlayer/mcp": patch
"@secondlayer/indexer": patch
---

Consolidate the decoded event-type vocabulary into a single `@secondlayer/shared` source (`DECODED_EVENT_TYPES`, `STREAMS_EVENT_TYPES`, and the now-exported `CHAIN_TRIGGER_TYPES`), replacing the duplicate literal copies in the SDK, indexer, and MCP tools. The MCP context resource now generates its `whatYouCanDo` capability list from the live tool registry, so it can no longer drift behind the actual tool surface.
