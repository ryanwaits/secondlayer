---
"@secondlayer/sdk": minor
"@secondlayer/cli": minor
"@secondlayer/mcp": minor
---

An `sk-sl_*` key passed as `apiKey` selects the hosted API, and any other explicit key stays local, so an instance token is never sent to the hosted API. The CLI now follows the same rule as the SDK and MCP. An asleep stack's 503 is not `retryable`, and the CLI says how to start it. MCP tools reject unknown arguments instead of dropping them.
