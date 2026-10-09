---
"@secondlayer/verify": minor
"@secondlayer/cli": patch
---

First public release of `@secondlayer/verify`: `verifyBlock` and `BlockVerifier` prove a Stacks block from a baked checkpoint (Bitcoin headers, burn binding, signer set and signatures, state witness, named diff, indexed rows) over untrusted sources, `SecondlayerProofSource` (`/v1/proofs`) and `NodeRpcProofSource`. The CLI now depends on the published package instead of bundling it.
