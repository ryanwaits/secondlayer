---
"@secondlayer/subgraphs": minor
---

NFT `tokenId` and print `value` now decode from the canonical hex (clean `cvToValue`, e.g. `223n`, `{}` for `(none)`) instead of the stacks-node's verbose serde-tagged form (`{ UInt: 223 }`, `{ Optional: { data: null } }`). This makes the values source-independent (identical whether the runtime reads the indexer DB or the public Index API) and far friendlier for handler authors. Behavior change for NFT `tokenId` and some print `data` shapes — reindex affected subgraphs to pick up the new representation.
