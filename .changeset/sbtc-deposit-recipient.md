---
"@secondlayer/shared": major
"@secondlayer/stacks": major
"@secondlayer/sdk": major
"@secondlayer/subgraphs": patch
---

sBTC deposits carry `recipient`, `fee` and `max_fee`. `recipient` is the Stacks principal the deposit minted sBTC to; before, the deposit's `sender` was always null. Breaking: the `sbtc_deposit` trigger and `on.sbtcDeposit` filter on `recipient` (was `sender`) and drop `requestId`; the deposit webhook payload drops `request_id`; `IndexSbtcDeposit` replaces `sender` and `recipient_btc_*` with `recipient`, `fee` and `max_fee`, and `sbtc.deposits.list` filters on `recipient`.
