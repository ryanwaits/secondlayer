---
"@secondlayer/shared": patch
"@secondlayer/api": minor
"@secondlayer/worker": minor
---

Wire the x402 rail onto live surfaces (Sprint 4), gated on `X402_SPONSOR_KEY` so it's a no-op until the sponsor wallet is funded. When live: Streams becomes keyless-but-paid (accountless callers pay per call via x402; keyed callers bypass — `streamsBearerAuth` anon fall-through + anon-tolerant rate-limit/retention) and Index's anon path is x402-gated. Adds `GET /x402/supported` (self-hosted capability + price catalog, no external Bazaar), `HiroClient.getTransaction`, and a worker cron (`x402-reconcile`, 5-min sweep over the last hour) that flips post-serve-reverted ledger rows.
