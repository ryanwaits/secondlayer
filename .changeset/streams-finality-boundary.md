---
"@secondlayer/shared": minor
"@secondlayer/indexer": minor
---

Add burn-block-anchored finality helpers. `@secondlayer/shared` exposes `DEFAULT_BTC_CONFIRMATIONS` + `finalizedBurnHeight()`, and the indexer adds `getFinalizedStacksHeight()` to map the burn-confirmation boundary to the highest finalized Stacks height. Post-Nakamoto finality is anchored to Bitcoin confirmations rather than a fixed Stacks-block lag.
