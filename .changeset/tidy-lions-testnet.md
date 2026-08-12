---
"@secondlayer/stacks": patch
---

Point the testnet sBTC constants at the live deployment. The testnet reset
retired the previous address, so every testnet sBTC call resolved to a contract
that no longer exists.
