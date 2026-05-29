---
"@secondlayer/cli": patch
---

`sl devnet connect` now wires the local stack so subscriptions are testable against a devnet: it shares one secrets key across the api and subgraph-processor (so the emitter can decrypt a subscription's signing secret) and allows webhook delivery to a localhost receiver (the emitter blocks private egress by default). Deploy a subgraph, create a subscription pointing at your local endpoint, and contract calls on the devnet deliver signed Standard-Webhooks payloads to it.
