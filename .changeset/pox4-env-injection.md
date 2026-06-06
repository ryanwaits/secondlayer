---
"@secondlayer/indexer": patch
---

`getEnabledL2DecoderNames` now reads pox4 from its injected `env` argument (mirroring sbtc/bns) instead of global `process.env`, so the enabled-decoder view is consistent and testable. Production behavior is unchanged (pox4 still default-on, opt-out via `POX4_DECODER_ENABLED=false`).
