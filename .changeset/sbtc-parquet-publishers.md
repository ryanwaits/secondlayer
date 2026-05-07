---
"@secondlayer/indexer": minor
"@secondlayer/api": patch
---

Add sBTC parquet publishers (events + token-events) under `stacks-datasets/mainnet/v0/sbtc/{events,token-events}/`. Single `SBTC_PUBLISHER_ENABLED` flag gates both. Manifest registry now exposes `sbtc-events` + `sbtc-token-events` slugs.
