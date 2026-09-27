---
"@secondlayer/indexer": patch
---

Adds bounded window re-derive tools for pox5_events and the BNS event logs, and an immediate-trigger command for the contracts registry, matching the existing decoded_events / sbtc_token_events re-derive pattern — the downstream repair step after restoring a short block's source transactions from the observer journal.
