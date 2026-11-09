---
"@secondlayer/sdk": patch
---

`btc_confirmations` on sBTC withdrawals counts to the current Bitcoin tip. It used to freeze once the sweep passed the settlement reorg-watch depth. An accepted withdrawal's detail is no longer immutably cached, since its confirmations keep growing.
