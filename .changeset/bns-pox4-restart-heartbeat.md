---
"@secondlayer/indexer": patch
---

Fix l2-decoder unhealthy on container restart for PoX-4 and BNS decoders. Both now bump their checkpoint `updated_at` timestamp at decoder startup (before entering the consume loop) so the health endpoint reports `checkpoint_recent: true` immediately. Without this, fresh containers showed unhealthy status until the first tick wrote a checkpoint — which for BNS-V2 prints (sparse) could take many minutes.

Also adds a first-enable seed for BNS: when no checkpoint exists, seed it to the latest canonical block before subscribing. Mirrors the existing PoX-4 first-enable seed and prevents BNS from sitting silent waiting for its first batch.
