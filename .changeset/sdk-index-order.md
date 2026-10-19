---
"@secondlayer/sdk": minor
---

`order: "desc"` on `index.events`, `index.ftTransfers` and `index.nftTransfers` `list()`/`walk()` reads newest first. New `IndexOrder` type. `consume()` stays forward-only.
