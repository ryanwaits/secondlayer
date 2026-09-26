---
"@secondlayer/indexer": minor
---

The 11 classic decoders (ft/nft/stx transfer, mint, burn, lock, print) now read Streams' own reader in-process off one shared cursor scan, instead of each running its own HTTP Streams consumer. Removes 2 HTTP round trips + 2 commit transactions per block on the common decode path. Checkpoints, sentinel semantics, reorg rewind, and health reporting are unchanged.
