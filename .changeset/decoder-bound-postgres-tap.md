---
"@secondlayer/subgraphs": patch
---

Bound subgraph catch-up and reindex tips by decoder progress only on the decoded Index (streams-index) plane. The Postgres tap reads raw events at ingest and must not stall on missing decoder checkpoints.
