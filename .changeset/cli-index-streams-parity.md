---
"@secondlayer/cli": minor
---

Bring the `sl` CLI to parity with the SDK for Index and Streams reads. Adds `sl index canonical`, `sl index blocks` (+ `blocks get <ref>`), `sl index transactions` (+ `transactions get <txId>`), `sl index stacking`, and `sl index mempool` (+ `mempool get <txId>`), plus `sl streams events by-tx <txId>` and `sl streams block-events <heightOrHash>`. List commands page by cursor (one page per call); bulk pagination stays in `sl streams consume`.
