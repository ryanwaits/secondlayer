---
"@secondlayer/shared": minor
---

`IndexHttpClient` gains `getDecodedHeights()`, reading the per-decoder committed-height map (`decoded_heights`) off the last tip envelope `getIndexTip()`/`getIndexSourceTip()` fetched — no extra request. Lets an HTTP-only Index reader (the chain-webhook evaluator) narrow its own progress bound to the decoders it actually reads instead of the conservative cross-decoder floor `block_height` alone carries. Additive: existing callers of `getIndexTip`/`getIndexSourceTip` are unaffected.
