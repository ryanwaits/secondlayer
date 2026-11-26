---
"@secondlayer/verify": patch
---

`blockTransactions` and `verifyBlock` reject a block body that repeats a txid. The tx merkle tree pads odd levels, so a repeated last transaction used to hash to the header's root.
