---
"@secondlayer/sdk": minor
---

`contractId` on `index.events` and `index.contractCalls` now accepts an array — `contractId: ["SP…sbtc-token", "SP…sbtc-registry"]` — so one consumer with one checkpoint can follow a protocol's whole contract set. Serialized as the comma list the API already uses on Streams; capped at 20 ids, and still mutually exclusive with `trait`.

Previously `contractId` was a single string, so watching sBTC (four contracts) or spanning a `v3` → `v4` migration meant one consumer per contract: N poll loops, N checkpoints, and no single answer to "how far is my index complete".

Use `trait` instead when you mean "every contract of a standard" — it resolves at read time and picks up contracts deployed after you ship.
