---
"@secondlayer/mcp": major
---

Remove the `SL_SERVICE_KEY` and `SECONDLAYER_API_KEY` env-var aliases — the MCP server now reads only `SL_API_KEY`, matching the CLI and SDK. (The previous release accepted them as deprecated aliases with a warning.) Update any MCP config that still sets `SL_SERVICE_KEY` to use `SL_API_KEY`.
