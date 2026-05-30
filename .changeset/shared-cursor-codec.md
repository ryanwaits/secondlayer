---
"@secondlayer/shared": minor
"@secondlayer/api": patch
"@secondlayer/indexer": patch
---

Centralize the Streams cursor codec in `@secondlayer/shared` (`encodeStreamsCursor`, `decodeStreamsCursor`, `EMPTY_RANGE_EVENT_INDEX_SENTINEL`). The API and indexer now delegate to one implementation instead of three near-identical copies, so encode/decode and the empty-range sentinel can't drift between products.
