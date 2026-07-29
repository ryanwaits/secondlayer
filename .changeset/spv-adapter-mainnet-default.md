---
"@secondlayer/stacks": minor
---

`@secondlayer/stacks/bitcoin`: `verifyBitcoinPayment` now resolves the published reference `spv-adapter` on mainnet when `contract` is omitted — `SPV_ADAPTER_CONTRACTS.mainnet` points at `SP2M1DE95TS0QBM4K893X6ST49FFJ53CCX9CYWNVY.spv-adapter`, the read-only wrapper over the SIP-044 built-ins deployed at Stacks Epoch 4.0. Testnet is deliberately absent: Stacks testnet has no Epoch 4.0, so the built-ins do not exist there and callers must pass an explicit `contract`; the thrown error now says so instead of advising callers to wait for activation.
