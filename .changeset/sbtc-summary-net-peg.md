---
"@secondlayer/api": patch
---

`/v1/index/sbtc/summary` now subtracts accepted withdrawals from `net_peg_flow_sats` and `total_locked_sats`, reading each amount from the matching `withdrawal-create` plus the accept's `fee`; accepts with no create are counted in the new `unmatched_withdrawal_accepts`.
