---
"@secondlayer/sdk": minor
---

Add `client.aggregate(spec)` to the typed subgraph table client plus the `queryTableAggregate` transport. SUM/MIN/MAX columns are compile-time numeric-only and the result type is inferred from the spec; sum/min/max values are lossless strings, counts are numbers.
