---
"@secondlayer/indexer": minor
"@secondlayer/api": patch
---

Add parquet exporters for `pox-4/calls`, `bns/name-events`, `bns/namespace-events`, `bns/marketplace-events`. Each ships behind its own `*_PUBLISHER_ENABLED` flag (no auto-on). Register the four new slugs in the `/v1/datasets/*` manifest map.

Refactors: extract `datasets/_shared/exporter.ts`, `scheduler.ts`, `parquet.ts` so adding new families is now a ~5-file, column-driven addition rather than a copy-paste of the sBTC pattern. Existing sBTC + STX-transfers families switched to the shared factories; output byte-identical.

Add `bun run --filter @secondlayer/indexer datasets:backfill <slug> --from <block> --to <block>` to walk historical ranges and upload.
