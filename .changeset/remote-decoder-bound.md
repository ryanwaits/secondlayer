---
"@secondlayer/subgraphs": patch
---

Chain webhooks and subgraph catch-up on an instance that reads Index over a remote API (`SUBGRAPH_INDEX_API_URL`) no longer stall on a missing local decoder checkpoint. Progress now comes from that API's `/public/status`.
