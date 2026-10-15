---
"@secondlayer/workload": minor
---

Nightly `pg_dump -Fc` of every running or stopped tenant to an S3-compatible bucket (`TENANT_BACKUP_*` env, Bun's `S3Client`), last 7 kept. Tenant destroy takes a final dump first (kept 30 days) and refuses to run without a bucket or when the dump fails. Tenant postgres is capped at 192 MB (`shared_buffers=32MB`, `max_connections=30`), webhook-service at 256 MB, and every tenant process uses a pool of 5 connections.
