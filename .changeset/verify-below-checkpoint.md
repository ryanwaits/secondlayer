---
"@secondlayer/verify": minor
"@secondlayer/cli": patch
---

`verifyBlock` proves blocks below the checkpoint: their id is tied to it by hash (parent links within 16 blocks, else one MARF proof of `__MARF_BLOCK_HEIGHT_TO_HASH::<height>` against the checkpoint's state root), then the header (Nakamoto or epoch 2.x) must hash to that id and the witness to its root. Adds the `ancestry` step and result field, `parseEpoch2Header` and `getEpoch2Header` on both sources. `secondlayer verify block <old height>` shows an `ancestry` link in place of the Bitcoin and signer links.
