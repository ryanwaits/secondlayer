---
"@secondlayer/sdk": minor
"@secondlayer/mcp": minor
---

Reindex no longer takes a block range on the SDK client or the MCP tool.

`subgraphs.reindex()` drops its `options` parameter, so the signature is now
`reindex(name)` and no body is sent. The API rejects a ranged reindex with
`400 REINDEX_RANGE_NOT_SUPPORTED`, so the old signature type-checked and then
failed at runtime.

The `subgraphs_reindex` MCP tool drops its `fromBlock` and `toBlock` parameters
from its input schema — an agent that still passes either now gets a schema
rejection — and its description no longer claims reindex runs "from a specific
block range".

Reindex is always whole-subgraph: dropped and rebuilt from the subgraph's start
block to chain tip. Use `subgraphs.backfill(name, { fromBlock, toBlock })` or
the `subgraphs_backfill` tool for ranged, additive work.
