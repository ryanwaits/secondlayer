---
"@secondlayer/shared": minor
"@secondlayer/sdk": minor
---

Add trustless transaction-inclusion proofs.

`@secondlayer/shared/node/nakamoto` parses Nakamoto block headers and recomputes the block_hash, index_block_hash, and tx_merkle_root the chain commits to; `@secondlayer/shared/node/consensus` verifies a header's signer signatures against the reward cycle's signer set. The SDK adds `verifyTransactionProof` (anchored + consensus levels) and `fetchRewardSet`, letting a consumer confirm a transaction's inclusion in a block — and that ≥70% of signer weight attested to that block — without trusting Secondlayer.
