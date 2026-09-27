---
"@secondlayer/shared": patch
"@secondlayer/api": patch
---

Fix the tx merkle root and inclusion proof for one-transaction blocks. Stacks consensus pairs a lone leaf with itself, so a one-tx block's root is H(0x01 ‖ leaf ‖ leaf); `txMerkleRoot` returned the bare leaf hash and `txMerkleProof` returned an empty path. That made `/v1/index/transactions/:tx_id/proof` produce a proof that failed verification for any transaction alone in its block, and made the node auditor's transaction attestation report a false mismatch for every one-tx block. Verified against mainnet block 9,070,019.
