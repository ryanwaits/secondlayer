---
"@secondlayer/indexer": minor
"@secondlayer/api": minor
---

Add BNS Foundation Dataset — closes the 5-dataset shelf alongside STX Transfers, sBTC, PoX-4, and Network Health.

**Decoder** (`l2.bns.v1`): subscribes to BNS-V2 contract print events, dispatches on three discriminator keys (`topic` for names, `status` for namespaces, `a` for marketplace), writes into 3 event tables and maintains 2 current-state projections (`bns_names`, `bns_namespaces`). Gated on `BNS_DECODER_ENABLED`.

**API** (`/v1/datasets/bns/*`): six endpoints — `name-events`, `namespace-events`, `marketplace-events`, `names`, `namespaces`, `resolve?fqn=alice.btc`. Cursor pagination on event endpoints; current-state lookups against the projections.

**Marketing**: `/datasets/bns` detail page, BNS flipped to "shipped" on the dataset index. Mainnet-only for v0; BNS-V1 historical data and subdomain resolution out of scope.
