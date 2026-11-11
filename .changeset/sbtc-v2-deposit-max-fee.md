---
"@secondlayer/sdk": patch
---

`max_fee` on sBTC deposits is filled for v2 deposits too. Their Bitcoin script holds only a hash, so the value is found by matching that hash against the deposit's recipient. v1 and v2 are told apart per deposit, with no activation height.
