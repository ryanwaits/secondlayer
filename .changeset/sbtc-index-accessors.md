---
"@secondlayer/sdk": minor
---

Add typed `index.sbtc` accessors for the decoded sBTC peg surface: `deposits` (list/walk/get-by-bitcoin-txid), `withdrawals` (list/walk/get-by-request-id), `events` (list/walk), and `summary`. Previously REST-only — callers had to hand-roll `fetch`. Exports the response/param types (`IndexSbtcDeposit`, `IndexSbtcWithdrawal`, `IndexSbtcEvent`, `IndexSbtcSummary`, and their envelopes).
