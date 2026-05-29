---
"@secondlayer/sdk": minor
---

Streams types expose finality: `StreamsEvent.finalized?` and `StreamsTip.finalized_height?` reflect the new fields the API returns, so consumers can tell which events are past the burn-confirmation finality boundary (immutable).
