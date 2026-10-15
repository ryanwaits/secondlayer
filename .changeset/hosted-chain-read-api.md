---
"@secondlayer/api": minor
---

Platform only: `POST /v1/chain-read/v2/contracts/call-read/:address/:name/:fn?tip=<index_block_hash>` serves contract reads to hosted subgraph processors. Node-compatible path and body, always pinned (`400 CHAIN_READ_UNPINNED` without a 64-hex tip), sender forced to the contract, body capped at 16 KB and 32 hex args, 3,000 reads a minute and 4 in flight per account, 16 in flight per process, 5 s node timeout (`504 CHAIN_READ_TIMEOUT`), and a shared cache of `okay: true` answers keyed by the pinned block (pruned after 30 days). Tenant keys only: a customer key gets `403 CHAIN_READ_TENANT_ONLY`. Workload-host tenant keys are now `api_keys.product = 'tenant'` (migration marks existing ones by `ip_address = 'workload-host'`); they read Streams and Index as before and no longer open account routes. Not in the OpenAPI document.
