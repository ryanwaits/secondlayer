---
"@secondlayer/stacks": patch
---

Fix sponsored-transaction signing: the initial-sighash sponsor sentinel used `signer = hash160(zero public key)` instead of the spec's 20 zero bytes (an empty-address hash160). That altered the origin's sighash, so every sponsored transaction was rejected by Stacks nodes with `SignatureValidation`. The sentinel now matches `@stacks/transactions`, verified by a new reference-vector test asserting byte-identical serialization (and proven end-to-end by a devnet sponsored broadcast). Unblocks the gasless x402 settlement path.
