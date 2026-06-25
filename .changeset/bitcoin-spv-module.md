---
"@secondlayer/stacks": minor
---

Add `@secondlayer/stacks/bitcoin` — trust-minimized Bitcoin SPV primitives for the SIP-044 (Clarity 6) native built-ins. Off-chain proof construction (`parseBitcoinTx`, `buildMerkleProof`, `buildTxProof` with trustless `bitcoinRpcSource`/`esploraSource`/`fallbackProofSource`), Clarity codecs (`encodeMerkleProofArgs`, `decodeTxOutput`, `parseOutputScript`), the verifier binding (`bitcoinVerifier`, `isClarity6Active`), and the high-level `verifyBitcoinPayment` action. The off-chain surface works today against live Bitcoin data; on-chain verification requires Clarity 6 / Epoch 4.0.
