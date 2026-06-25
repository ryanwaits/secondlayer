---
"@secondlayer/stacks": patch
---

Validate principal/contract inputs at the wallet-action boundary: transferStx checks `to`, callContract validates the contract id before both the provider and local paths, and deployContract checks `contractName`. Malformed input now fails fast with a clear message instead of being forwarded to the wallet or surfacing a cryptic encoder error.
