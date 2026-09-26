---
"@secondlayer/indexer": patch
---

The classic decoders (ft/nft/stx transfer, mint, burn, lock, print) now commit the end-of-block sentinel cursor directly when a Streams page comes back shorter than the requested batch size, instead of waiting on a follow-up empty poll to prove the block is done. Cuts one HTTP fetch + one commit transaction off the common per-block path.
