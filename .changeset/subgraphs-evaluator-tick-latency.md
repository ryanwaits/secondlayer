---
"@secondlayer/subgraphs": patch
---

The chain-webhook evaluator drops its per-tick `GET /public/status` poll: on a remote-Index instance, `decoderBoundTip` now reads per-decoder committed heights off the SAME tip envelope the block source's `getTip()` already fetched, bounding by the MIN over only the decoders its active webhooks reference — a stalled decoder no webhook reads (e.g. an idle `print`) still never gates progress, matching local mode. Falls back to trusting the raw tip when an older server doesn't send that map. The evaluator also runs the independent sBTC-settlement scan concurrently with the tip fetch, skips fetching full transactions on a tick with no `contract_call`/`contract_deploy` trigger, and re-arms immediately (instead of waiting the poll interval) after a tick that advanced the cursor, so a backlog drains without idle gaps.
