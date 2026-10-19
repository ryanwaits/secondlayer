---
"@secondlayer/sdk": minor
---

`sl.index.bitcoin.outspend(txid, vout)` reads `GET /v1/bitcoin/outspend/{txid}/{vout}`: whether a Bitcoin output is spent, by which transaction and input, and whether the spend is in a block or the mempool. Resolves to `null` on 404. Types: `BitcoinOutspend`, `BitcoinOutputSpent`, `BitcoinOutputUnspent`, `BitcoinResource`.
