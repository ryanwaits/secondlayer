---
"@secondlayer/shared": patch
"@secondlayer/subgraphs": patch
"@secondlayer/indexer": patch
"@secondlayer/api": patch
---

Single-source the internal Index/Streams HTTP client.

Decoder and subgraph processor now share `createInternalIndexHttpClient()`
and the Streams key helper. Empty `STREAMS_INTERNAL_API_KEY` (compose
`${VAR:-}`) falls back to the seeded default instead of sending `Bearer `.
