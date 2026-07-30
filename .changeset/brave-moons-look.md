---
"@secondlayer/sdk": minor
---

Field projection on sBTC deposit reads. `sl.sbtc.deposits.list({ fields: ["amount", "bitcoin_txid"] })` returns rows carrying only those columns plus `cursor`/`block_height`, and the row type narrows to match — reading an unrequested column is a compile error rather than `undefined` at runtime.

Projection previously existed only on `/v1/index/events`, so every sibling resource returned full rows whether or not the caller wanted them. The parse-and-strip logic is now shared, so the two rules that matter — a misspelled field is refused rather than ignored, and the pagination keys always survive — hold the same way everywhere they are applied.
