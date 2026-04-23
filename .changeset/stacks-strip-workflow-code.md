---
"@secondlayer/stacks": major
---

Strip all workflow-runner-only code.

- Removed `broadcast()`, `broadcastContext`, `BroadcastOptions/Result/Runtime` — was tied to the AsyncLocalStorage-bound workflow runner that no longer exists.
- Removed `TxRejectedError`, `TxTimeoutError`, `TxSignerRefusedError`, `TxRejectionReason` — broadcast-only error classes.
- Removed `tx.transfer/contractCall/deploy/multiSend` intent builders + `TxIntent` types — intent shapes for workflow handlers.
- Removed `/ui` subpath + all json-render atoms (`address`, `amount`, `blockHeight`, `bnsName`, `nftAsset`, `principal`, `token`, `txStatus`, `defineCatalog`, `atomComponentMap`) — was for `step.render()` only.
- Removed `/ui/schemas` subpath + its Zod schema exports.
- Dropped React + @json-render peer deps (no longer needed).

For transaction broadcasts from receiver code, use `buildTokenTransfer`, `buildContractCall`, `buildContractDeploy` from `@secondlayer/stacks/transactions` — standalone, no runtime context required.
