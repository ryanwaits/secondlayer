---
"@secondlayer/shared": patch
"@secondlayer/api": patch
"@secondlayer/worker": patch
---

fix: x402 payment confirmation queried `decoded_events` with the bare broadcast txid, but the index stores `tx_id` `0x`-prefixed — so every confirmation silently failed. Optimistic payments reverted after the grace window and struck the payer (downgrading legit users to confirmed-tier); confirmed-tier deposits/deploys never confirmed. Add `toIndexTxId()` to `@secondlayer/shared/x402` and apply it in the reconciler (`defaultIsCanonical`) and the confirmed-tier verifier (`verifyTransferByTxId`).
