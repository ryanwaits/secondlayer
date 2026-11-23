---
"@secondlayer/mcp": minor
---

`index_events` accepts the Clarity state types (`nested_contract_call`, `var_set`, `map_set`, `map_insert`, `map_delete`) with their `functionName`, `caller`, `map`, `varName` and `txId` filters, and the new `index_state_writes` tool reads the exact state writes each block committed.
