---
"@secondlayer/api": patch
"@secondlayer/sdk": patch
---

Index sBTC withdrawals list (`/v1/index/sbtc/withdrawals`) now returns settlement detail inline per row — `btc_confirmations`, `btc_block_height`, `confirmed_at` — alongside the existing `settlement_confirmed` flag. Previously only the single-withdrawal detail endpoint carried these, forcing N+1 fetches to render verified BTC-L1 settlement in a list.
