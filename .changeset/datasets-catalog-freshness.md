---
"@secondlayer/api": patch
---

Enrich the `GET /v1/datasets` catalog: each family now carries `freshness` (status/latest_finalized_cursor/generated_at/to_block/lag_blocks from its bulk-export manifest) and `manifest_url` (the Parquet manifest for DuckDB analytics), or null when no bulk export exists. The BNS name-events manifest is aliased onto the `bns-events` family. The discovery endpoint stays 200 when the chain tip is unavailable (lag is reported as null rather than 503). Makes `datasets_list`'s "how current each is" claim truthful.
