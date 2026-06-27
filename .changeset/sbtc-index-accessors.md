---
"@secondlayer/sdk": minor
---

Add typed `index.sbtc` and `index.pox` accessors for the decoded sBTC peg and PoX reward-cycle surfaces (previously REST-only — callers had to hand-roll `fetch`):

- `index.sbtc.deposits` (list/walk/get-by-bitcoin-txid), `index.sbtc.withdrawals` (list/walk/get-by-request-id), `index.sbtc.events` (list/walk), `index.sbtc.summary`.
- `index.pox.cycles` (list/walk/get-by-reward-cycle).

Exports the response/param types (`IndexSbtcDeposit`, `IndexSbtcWithdrawal`, `IndexSbtcEvent`, `IndexSbtcSummary`, `IndexPoxCycle`, and their envelopes).
