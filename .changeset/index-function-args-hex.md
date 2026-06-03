---
"@secondlayer/sdk": minor
"@secondlayer/api": patch
---

Expose raw hex `function_args_hex` on `/v1/index/transactions` (the `contract_call` sub-object) alongside the decoded `function_args`, for consumers that decode ClarityValues themselves (`decode(function_args_hex[i]) === function_args[i]`). Used by the subgraph runtime's Index source to reconstruct contract_call transactions identically to the DB tap.
