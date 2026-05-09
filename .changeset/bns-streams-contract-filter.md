---
"@secondlayer/sdk": patch
"@secondlayer/indexer": patch
---

fix(streams): pipe contractId through events.consume / events.stream

The streams events consumer had no way to push a server-side `contract_id` filter into the events fetch — only `types` was forwarded. On a backfill from a stale checkpoint that translates to "scan every print event in the cursor range across every contract," which on mainnet hit socket-close timeouts and stalled the BNS decoder. SDK `events.consume` / `events.stream` now accept `contractId` and forward it to the API; the BNS decoder uses it for the BNS-V2 mainnet contract.
