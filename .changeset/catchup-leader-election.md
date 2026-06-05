---
"@secondlayer/subgraphs": patch
---

Leader-elect the subgraph catch-up driver so the processor can scale out. Catch-up ran on every NOTIFY/poll guarded only by an in-process Set, so 2+ processors double-processed every block (idempotent upserts kept it correct, but with no throughput gain). The NOTIFY/poll/startup paths now share one `runCatchUp()` helper gated on `isCatchUpLeader()` (`SUBGRAPH_CATCHUP_LOCK_KEY`, pinned to the target DB that homes the `subgraphs` table); a newly elected leader runs an immediate catch-up. The in-process Set stays as the within-process guard.
