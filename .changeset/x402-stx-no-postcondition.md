---
"@secondlayer/stacks": patch
"@secondlayer/api": patch
---

Fix x402 native-STX payments: a `TokenTransfer` payload cannot carry post-conditions (Stacks consensus rejects it with "TokenTransfer transactions do not support post-conditions"), so `buildExactTransfer` no longer attaches one for STX — exactness is already inherent in the signed amount+recipient. `verifyPayment` now derives the payer from the origin spending condition (works for STX, which has no post-condition to read it from) and only requires the Deny-mode FT post-condition for SIP-010. Proven by a devnet end-to-end: the sponsored STX transfer mined with the payer paying 0 gas and the sponsor paying the fee.
