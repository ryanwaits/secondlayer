---
"@secondlayer/shared": patch
---

Parse Epoch 4.0 Nakamoto headers. Version 1 appends `problematic_txs` after `pox_treatment` and includes those bytes in the signer-signature-hash preimage, so post-fork block identities recompute.
