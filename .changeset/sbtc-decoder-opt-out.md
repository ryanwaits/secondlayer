---
"@secondlayer/indexer": patch
---

default sbtc decoder to enabled — flip `SBTC_DECODER_ENABLED` from opt-in (`=== 'true'`) to opt-out (`!== 'false'`) and bump docker-compose default to `:-true`. The `/v1/datasets/sbtc/events` endpoint is public, so the decoder that fills it ships on by default. OSS users on chains without sBTC can still disable with `SBTC_DECODER_ENABLED=false`.
