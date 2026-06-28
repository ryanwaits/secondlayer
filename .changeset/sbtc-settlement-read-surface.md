---
"@secondlayer/sdk": minor
"@secondlayer/api": minor
---

Surface BTC L1 settlement on the sBTC withdrawal read API: `/v1/index/sbtc/withdrawals/:request_id` now fills `settlement.{btc_confirmations,settlement_confirmed,btc_block_height,confirmed_at}` from the confirmer instead of nulls, the rolled-up withdrawals list carries a `settlement_confirmed` flag plus a `?settlement_confirmed=` filter, and the SDK types/`settlementConfirmed` param match.
