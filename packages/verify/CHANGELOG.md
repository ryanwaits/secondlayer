# @secondlayer/verify

## 0.1.0

### Minor Changes

- d81cbc2: First public release of `@secondlayer/verify`: `verifyBlock` and `BlockVerifier` prove a Stacks block from a baked checkpoint (Bitcoin headers, burn binding, signer set and signatures, state witness, named diff, indexed rows) over untrusted sources, `SecondlayerProofSource` (`/v1/proofs`) and `NodeRpcProofSource`. Billed Index reads (`state_writes`, `vm_events`) happen only with `rows: true`. The CLI now depends on the published package instead of bundling it.
