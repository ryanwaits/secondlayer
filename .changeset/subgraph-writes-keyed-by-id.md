---
"@secondlayer/shared": minor
"@secondlayer/subgraphs": patch
"@secondlayer/api": patch
---

A subgraph deleted and deployed again under the same name now starts clean. Progress, counters, billing pauses, gaps, violations, error groups and processing stats follow the subgraph's id instead of its name, so a block batch still running for the old one can no longer move the new one, and nothing of the old one shows up in the new one's dashboard or insights. Deleting a subgraph drops its schema and its registry row in one transaction. The query helpers in `@secondlayer/shared` (`recordLiveProgress`, `recordLiveError`, `rewindLiveProgress`, `setReindexCursor`, `recordSubgraphProcessed`, `markSubgraphBillingPaused`, `clearSubgraphBillingPaused`, `updateSubgraphHandlerPath`, `findSubgraphGaps`, `resolveGaps`, `countSubgraphMissingBlocks`) take the subgraph id where they took the name. Subgraphs are still addressed by name in the API, CLI and SDK. The next migration adds `subgraph_id` to the three side tables and removes rows of subgraphs that no longer exist.
