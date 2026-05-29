---
"@secondlayer/api": minor
---

Streams finalized pages now support conditional requests: immutable `/events` pages carry a weak `ETag` and `/canonical/:height` honors `If-None-Match`, returning `304 Not Modified` on a match (before metering). Lets clients and caches revalidate cheaply.
