---
"@secondlayer/sdk": patch
---

`BaseClient` now serializes BigInt values in request bodies to strings (via a JSON.stringify replacer) and surfaces body-encoding failures with a clear error message instead of masking them as "Cannot reach API". Fixes `sl subgraphs deploy` silently failing on configs that use bigint literals (e.g. `minAmount: 1_000_000n` in an `stx_transfer` filter).
