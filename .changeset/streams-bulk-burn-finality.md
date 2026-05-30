---
"@secondlayer/indexer": patch
---

Align the Streams bulk-dump publisher with the burn-confirmation finality boundary used by the Streams read path. The publisher now derives the finalized range from `finalizedBurnHeight` → `getFinalizedStacksHeight` (BTC confirmations, default 6) instead of the legacy 144-Stacks-block lag, so dumps and live reads agree on what is final. Replaces the `STREAMS_BULK_FINALITY_LAG_BLOCKS` env (now ignored on the streams path) with `STREAMS_BULK_BTC_CONFIRMATIONS`. The dataset exporters are unchanged.
