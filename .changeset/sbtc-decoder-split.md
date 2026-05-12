---
"@secondlayer/indexer": patch
"@secondlayer/api": patch
---

split sbtc decoder into registry + token, narrow filter to avoid socket timeouts

`l2.sbtc.v1` previously fetched `print` + `ft_transfer/mint/burn` events across all contracts with `batchSize: 500` and no server-side filter, mirroring the unfiltered scan bug BNS already fixed — the upstream socket closes mid-response on long-running historical scans. Split into two decoders backed by one source file:

- `l2.sbtc.v1` — registry `print` events on `<network>.sbtc-registry`, writes `sbtc_events`
- `l2.sbtc_token.v1` (new checkpoint) — `ft_transfer/mint/burn` on `<network>.sbtc-token`, writes `sbtc_token_events`

Each uses `batchSize: 100` and a server-side `contractId` filter selected via `STACKS_NETWORK`. `/public/status` reports both via `status.ts` mapping. `getEnabledL2DecoderNames` and the health-module `readLatestDecodedAt` switch surface the new decoder too. Existing `l2.sbtc.v1` checkpoint preserved.
