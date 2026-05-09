---
"@secondlayer/api": patch
---

fix(api): raise Bun.serve idleTimeout 10 → 60s

Slow streams queries (the unindexed jsonb scan that backs `types=print&contract_id=...`) regularly take 5–20s on backfill. Bun's default 10s idle timeout was closing the socket mid-response, surfacing as `socket connection was closed unexpectedly` in downstream consumers (the L2 BNS decoder, which then sat at the same checkpoint forever).
