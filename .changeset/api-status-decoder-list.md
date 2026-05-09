---
"@secondlayer/api": patch
"@secondlayer/indexer": patch
---

fix(api): public status surfaces every enabled L2 decoder

`/public/status.index.decoders[]` was hardcoded to `[ft, nft]` even when sbtc/pox4/bns were running. The list now derives from the same `*_DECODER_ENABLED` env flags the indexer reads, via a re-exported `getEnabledL2DecoderNames()` from `@secondlayer/indexer/l2/health`.
