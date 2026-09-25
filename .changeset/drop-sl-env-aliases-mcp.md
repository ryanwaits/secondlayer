---
"@secondlayer/mcp": major
---

`SL_API_URL` is no longer read. The MCP server and client now resolve the instance base URL through the SDK's `resolveBaseUrl()`, which reads only `SECONDLAYER_API_URL` (falling back to `http://127.0.0.1:3800`). Set the canonical name in your MCP client config.
