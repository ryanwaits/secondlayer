---
"@secondlayer/api": patch
---

Add a `trait=` filter to Index reads — `GET /v1/index/events` (contract-keyed event types: ft/nft transfers, mints, burns, print) and `GET /v1/index/contract-calls` now accept `trait=<standard>` (e.g. `sip-010`), resolving via the contract registry as-of the window end and restricting results to conforming contracts. Mutually exclusive with `contract_id`. Brings trait-scoped reads (already in Subgraphs + `/v1/contracts`) to the Index layer; discovery advertises it per event type.
