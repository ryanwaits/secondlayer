---
"@secondlayer/api": minor
---

Add `GET /v1/index/sbtc/summary` — the peg scoreboard cap to the keyless sBTC
read surface. One scalar aggregate over the whole bridge: lifecycle counts
(deposits, withdrawals requested/accepted/rejected), net peg flow and locked
sats (bigint-safe), and circulating sBTC supply in sats (mints − burns over
canonical token events; null when no token events recorded). Keyless, short-cached (30s),
discovery + OpenAPI entries included.
