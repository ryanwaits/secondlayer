---
"@secondlayer/sdk": minor
"@secondlayer/indexer": minor
"@secondlayer/api": minor
---

Index now decodes and serves STX transfers, mints, and burns for tokens. `GET /v1/index/events` accepts `event_type` of `stx_transfer`, `stx_mint`, `stx_burn`, `ft_mint`, `ft_burn`, `nft_mint`, and `nft_burn` alongside the existing transfer types.

SDK adds `decodeStxTransfer`, `decodeStxMint`, `decodeStxBurn`, `decodeFtMint`, `decodeFtBurn`, `decodeNftMint`, `decodeNftBurn` (plus their decoded types, `is*` guards, and the `DecodedEventColumns` helper) and widens `DecodedEventRow` to the full set. The indexer runs a decoder per new type; the API registry and OpenAPI expose them with per-type filters.
