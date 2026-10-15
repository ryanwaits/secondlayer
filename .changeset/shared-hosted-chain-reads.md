---
"@secondlayer/shared": minor
---

`IndexHttpClient` reads sBTC events (`fetchSbtcEvents`), trait members (`listContractsByTrait`) and settled withdrawals (`fetchSettledWithdrawals`). `hasNoLocalChain` moves to `db/queries/instance` so the api and the webhook evaluator share one rule for a hosted stack.
