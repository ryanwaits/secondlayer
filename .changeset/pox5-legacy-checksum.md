---
"@secondlayer/stacks": patch
---

PoX-5 `parseBtcAddress` verifies Base58Check on legacy P2PKH/P2SH instead of accepting any 25-byte decode.
