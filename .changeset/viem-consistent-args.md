---
"@secondlayer/stacks": minor
"@secondlayer/cli": patch
---

`callContract` and the multisig client's `callContract` take `args`, like `readContract` and `simulateCall`. `functionArgs` still works and is deprecated. New `verifyMessage({ message, signature, publicKey })`; `verifyMessageSignature` is deprecated.
