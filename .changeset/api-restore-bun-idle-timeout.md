---
"@secondlayer/api": patch
---

restore Bun.serve idleTimeout (10s → 90s). The fix originally landed in `0650816b` for slow streams queries; was silently reverted in `9a4c8d35` and resurfaced as a fresh UX bug: `sl subgraphs delete` against a mid-reindex subgraph completes server-side in ~14s but the client sees "Server error" because Bun closes the socket at the default 10s. Long-tail operations include the `waitForSubgraphOperationsClear` poll (up to 30s), jsonb scans during BNS backfill (5–20s), and dense streams page reads. 90s covers all known cases with headroom. Code comment now flags the prior revert so this doesn't get undone again.
