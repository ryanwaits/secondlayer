---
"@secondlayer/stacks": patch
---

`formatBtcAddress` encodes legacy P2PKH/P2SH with `@scure/base` and portable `doubleSha256` instead of `Bun.CryptoHasher`.
