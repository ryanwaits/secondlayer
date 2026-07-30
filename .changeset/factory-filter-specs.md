---
"@secondlayer/stacks": patch
---

`ContractCallSpec` and `PrintEventSpec` accept a contract SET (`string | readonly string[]`), matching the subgraphs filter. `toChainTrigger()` throws for a set rather than silently taking the first entry — a chain trigger targets one contract, so watching a fraction of what the filter says would be worse than a loud error. Index and Subgraphs projections carry the set through.
