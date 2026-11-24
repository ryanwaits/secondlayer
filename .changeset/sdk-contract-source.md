---
"@secondlayer/sdk": minor
---

`contracts.get(id, { includeSource: true })` returns the contract's deployed Clarity source as `source`, with no Stacks node involved. `ContractSummary` gains `classified_at` and `source`.
