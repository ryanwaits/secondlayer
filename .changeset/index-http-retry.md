---
"@secondlayer/shared": patch
---

`IndexHttpClient` now retries transport failures (connection refused/reset) and gateway statuses (502/503/504) with bounded exponential backoff. Makes a single api-replica recreate transparent to the streams-index subgraph-processor / l2-decoder, closing the processors-depend-on-api coupling once the API runs N>1 replicas behind Caddy
</content>
