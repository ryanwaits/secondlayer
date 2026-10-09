# @secondlayer/verify

## 0.2.0

### Minor Changes

- addfa8b: `verifyBlock` proves blocks below the checkpoint: their id is tied to it by hash (parent links within 16 blocks, else one MARF proof of `__MARF_BLOCK_HEIGHT_TO_HASH::<height>` against the checkpoint's state root), then the header (Nakamoto or epoch 2.x) must hash to that id and the witness to its root. Adds the `ancestry` step and result field, `parseEpoch2Header` and `getEpoch2Header` on both sources. `secondlayer verify block <old height>` shows an `ancestry` link in place of the Bitcoin and signer links.

## 0.1.0

### Minor Changes

- d81cbc2: First public release of `@secondlayer/verify`: `verifyBlock` and `BlockVerifier` prove a Stacks block from a baked checkpoint (Bitcoin headers, burn binding, signer set and signatures, state witness, named diff, indexed rows) over untrusted sources, `SecondlayerProofSource` (`/v1/proofs`) and `NodeRpcProofSource`. Billed Index reads (`state_writes`, `vm_events`) happen only with `rows: true`. The CLI now depends on the published package instead of bundling it.
