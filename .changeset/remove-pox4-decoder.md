---
"@secondlayer/sdk": major
"@secondlayer/shared": major
"@secondlayer/cli": major
"@secondlayer/subgraphs": patch
"@secondlayer/mcp": patch
---

Remove the dedicated PoX-4 decoder and `/v1/index/stacking`. The SDK drops `index.stacking` and its `IndexStackingAction`/`Stacking*` types, the CLI drops `secondlayer index stacking`, and shared drops `isPox4DecoderEnabled`, the `POX4_DECODER_ENABLED` flag and the `pox4_calls` table types (migration 0206 drops the table). pox-4 is retired; read its history from `/v1/index/contract-calls?contract_id=SP000000000000000000002Q6VF78.pox-4` or Streams filtered by that `contract_id`.
