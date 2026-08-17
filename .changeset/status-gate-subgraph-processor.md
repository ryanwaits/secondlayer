---
"@secondlayer/api": patch
---

Stop reporting `subgraph_processor` as permanently `unavailable` on platform/archive deployments. The processor was retired there for good (ops-f087), so `/status` and `/public/status` now omit the `subgraph_processor` entry (and `/public/status`'s top-level `subgraphProcessor` object) in platform mode instead of reporting a false alarm forever. `oss` self-host deployments are unaffected — the heartbeat check still surfaces there exactly as before.
