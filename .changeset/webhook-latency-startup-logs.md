---
"@secondlayer/indexer": patch
---

The L2 decoder's wake listener now logs the channel name and redacted DB host it connected (or failed to connect) to at startup, so a split-DB LISTEN/NOTIFY mismatch is visible in `docker logs` instead of only inferable from a latency graph.
