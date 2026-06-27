---
"@secondlayer/stacks": patch
---

`@secondlayer/stacks/bitcoin`: `verifyBitcoinPayment`'s `contract` is now optional — it resolves the reference `spv-adapter` from `SPV_ADAPTER_CONTRACTS` for the target network (throws a guided error until one is deployed at Epoch 4.0). Adds `getSpvAdapter(network)` and `spvAdapterPrincipal(ref)` accessors so the adapter principal lives in one place.
