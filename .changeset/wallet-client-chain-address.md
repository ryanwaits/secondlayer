---
"@secondlayer/stacks": minor
---

`createWalletClient` now uses the address for its chain when the account comes from a local key, so `privateKeyToAccount(key)` works on testnet and devnet without `addressVersion`. Provider accounts are unchanged.
