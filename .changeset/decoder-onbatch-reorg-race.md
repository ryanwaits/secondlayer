---
"@secondlayer/indexer": patch
---

In-flight decoder onBatch commits abort if a concurrent reorg rewound the checkpoint, instead of stamping next_cursor over the rewind.
