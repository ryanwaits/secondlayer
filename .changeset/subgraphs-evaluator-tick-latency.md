---
"@secondlayer/subgraphs": patch
---

The chain-webhook evaluator drops its per-tick `GET /public/status` poll: on a remote-Index instance, the block source's own tip is now trusted directly (the Index API already enforces the committed-height rule server-side), so `decoderBoundTip` returns unbounded in that mode instead of making a second request. The evaluator also runs the independent sBTC-settlement scan concurrently with the tip fetch, skips fetching full transactions on a tick with no `contract_call`/`contract_deploy` trigger, and re-arms immediately (instead of waiting the poll interval) after a tick that advanced the cursor, so a backlog drains without idle gaps.
