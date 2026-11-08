---
"@secondlayer/cli": patch
"@secondlayer/mcp": patch
"@secondlayer/sdk": patch
---

An account's `email` is typed `string | null` (an account minted before sign-up has none). `login` names such an account by its id, and `ContextAccount.email` in the SDK and the MCP `account_whoami` result can be null.
