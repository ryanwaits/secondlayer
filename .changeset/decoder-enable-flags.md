---
"@secondlayer/shared": patch
"@secondlayer/indexer": patch
"@secondlayer/api": patch
---

Single-source sBTC/BNS/PoX decoder enable flags in `@secondlayer/shared`.

`/public/status`, the decoder process, and Index protocol feeds now share
`isSbtcDecoderEnabled` / `isBnsDecoderEnabled` / the existing PoX helpers,
so an inverted `=== "true"` vs `!== "false"` cannot drift across surfaces.
