---
"@secondlayer/indexer": patch
---

The pox-5 decoder now fills `signer` on `claim-rewards`, `claim-staker-rewards-for-signer`, `grant-signer-key`, and `revoke-signer-grant` with the same principal as `signer-manager`. These topics only ever printed `signer-manager`, but the contract's own assertions make it the signer, so `signer=` alone now returns a pool's full pox-5 activity instead of missing every claim and key grant.
