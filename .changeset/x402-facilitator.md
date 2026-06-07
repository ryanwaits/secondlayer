---
"@secondlayer/api": minor
---

x402 facilitator (Sprint 2): price catalog with a dynamic gas-aware floor (`x402/catalog.ts`), static payment verification + confirmed-tier settlement that block-polls until the transfer is canonical (`x402/facilitator.ts`), a fail-closed Redis nonce/replay store (`x402/nonce-store.ts`), and a by-txid canonical transfer reader (`index/transfer-by-txid.ts`).
