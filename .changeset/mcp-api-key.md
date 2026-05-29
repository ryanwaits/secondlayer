---
"@secondlayer/mcp": minor
---

Standardize on `SL_API_KEY` for the MCP server's API credential, matching the CLI and SDK. `SL_SERVICE_KEY` and `SECONDLAYER_API_KEY` continue to work as deprecated aliases (logged once per process), so existing MCP configs keep functioning. README and config examples now lead with `SL_API_KEY`.
