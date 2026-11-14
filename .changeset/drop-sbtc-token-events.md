---
"@secondlayer/shared": major
"@secondlayer/subgraphs": patch
---

Drop the `sbtc_token_events` table and its `decode.sbtc_token.v1` decoder. Shared drops the `sbtc_token_events` table type and the `SbtcTokenEventType` export (the migration drops the table), and `codegen index` no longer emits `sbtc_token_events`. sBTC token transfers, mints and burns are read from `/v1/index/ft-transfers?asset_identifier=SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token`, or Streams filtered by that `contract_id`.
