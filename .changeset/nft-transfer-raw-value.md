---
"@secondlayer/sdk": patch
---

fix `decodeNftTransfer` reading wrong payload field. live streams emits the token id as a typed Clarity value at `payload.value` (e.g. `{UInt: 52}`) and the canonical hex at `payload.raw_value`. the decoder was reading `payload.value` and throwing on every event, leaving `decoded_events` empty for `nft_transfer`. now prefers `raw_value`, mirroring the indexer 1.3.7 sbtc/bns fix.
