---
"@secondlayer/shared": patch
---

Add `service_heartbeats` table (migration 0074) — long-running services (subgraph-processor, decoders) upsert a row every 30s so the platform can surface their liveness without docker introspection.
