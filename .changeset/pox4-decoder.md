---
"@secondlayer/indexer": minor
---

Add PoX-4 transaction-result decoder (`l2.pox4.v1`). Reads canonical successful pox-4 contract calls from the local transactions table, decodes args + result via Clarity deserialization, writes to `pox4_calls`. Mainnet-only; forward-only ingestion (auto-seeds checkpoint to tip on first enable). Covers all 12 supported PoX-4 functions: stack-stx/extend/increase, delegate-stx, revoke-delegate-stx, delegate-stack-stx/extend/increase, stack-aggregation-commit/commit-indexed/increase, set-signer-key-authorization. Gated on `POX4_DECODER_ENABLED`.
