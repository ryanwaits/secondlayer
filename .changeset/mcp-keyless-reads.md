---
"@secondlayer/mcp": patch
---

Allow keyless reads. The MCP server no longer requires `SL_SERVICE_KEY` to start — read tools (`list`, `get`, `query`, `spec`) work without a key during open beta, and only writes/account tools need an `sk-sl_` key. Also fixes a stale error message that referenced the removed `sl instance info` command.
