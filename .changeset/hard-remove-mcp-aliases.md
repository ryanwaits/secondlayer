---
"@secondlayer/mcp": major
---

Remove the deprecated tool aliases and rename `subgraphs_get`, so every tool name is `<product>_<verb>` with no second spelling.

- `scaffold_from_contract` → `subgraphs_scaffold`
- `get_contract_abi` → `contracts_get_abi`
- `subgraphs_get` → `subgraphs_status` (the capability is one subgraph's status, matching `sl.subgraphs.status()` and `secondlayer subgraphs status`)

`subscriptions_get` and `contracts_get_abi` keep their names. Agent configs pinned to a removed name must be updated — the server no longer registers it.
