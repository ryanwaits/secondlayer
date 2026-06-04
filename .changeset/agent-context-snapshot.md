---
"@secondlayer/sdk": minor
"@secondlayer/mcp": minor
"@secondlayer/cli": minor
---

Add an agent orientation snapshot available to every surface, not just MCP. `SecondLayer.context()` (SDK) assembles, concurrently and degrading to `null` per field, the account, live Streams + Index tips, your subgraphs/subscriptions (with a per-status breakdown), and any in-flight reindex operations. The MCP `secondlayer://context` resource now builds on this — so it gains the tips, subscription health, and in-flight operations it lacked — and `sl context` (CLI) prints the same snapshot so non-MCP agents aren't context-starved.
