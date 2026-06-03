---
"@secondlayer/subgraphs": minor
---

NFT event handlers now receive `tokenId` decoded from the canonical hex (clean `cvToValue`, e.g. `223n`) instead of the stacks-node's verbose serde-tagged form (`{ UInt: 223 }`). This makes the value source-independent (identical whether the runtime reads the indexer DB or the public Index API) and far friendlier for handler authors. Print event values already decoded this way. Behavior change for NFT `tokenId` shape — reindex NFT subgraphs to pick up the new representation.
