---
"@secondlayer/stacks": patch
---

`deserializeTransaction` reads a multisig public-key field flagged uncompressed (id `0x01`) as 33 bytes, matching consensus. Such transactions (e.g. mainnet block 57628) previously failed with a buffer underflow.
