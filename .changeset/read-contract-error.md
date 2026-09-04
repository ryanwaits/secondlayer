---
"@secondlayer/stacks": patch
---

`readContract` throws `ReadContractError` (`code: READ_CONTRACT_ERROR`) when `/v2/contracts/call-read` answers `okay: false`, and `MalformedResponseError` when `okay` is true but `result` is missing. Same message as before (the node cause). Exported from `@secondlayer/stacks`.
