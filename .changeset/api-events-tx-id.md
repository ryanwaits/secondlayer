---
"@secondlayer/api": patch
---

Index events accept `tx_id` on every event type, not only VM types. A `tx_id` read always reads that transaction's block; a window that misses it, or an unknown transaction, answers empty.
