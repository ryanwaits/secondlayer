---
"@secondlayer/sdk": patch
"@secondlayer/cli": patch
"@secondlayer/mcp": patch
---

Document the API-key product/scope model in the package READMEs: an `account` key is the owner credential (reads Streams + Index, and is the only key that can mint), while `streams`/`index` keys are scoped reads that cannot mint. Adds the key-mint paths — `sl.apiKeys.create()`, `sl keys create`, and the `account_create_key` MCP tool.
