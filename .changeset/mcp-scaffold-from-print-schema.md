---
"@secondlayer/mcp": patch
"@secondlayer/scaffold": patch
---

MCP subgraphs_scaffold prefers observed print-schema topics; falls back to SIP-010/009 token transfers then ABI contract_call. Token/trait scaffolds live in @secondlayer/scaffold (asset_identifier is text; optional balances via ctx.increment).
