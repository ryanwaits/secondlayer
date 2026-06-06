---
"@secondlayer/subgraphs": patch
---

Make the HTTP (Streams+Index) block source a soft dependency: when `SUBGRAPH_SOURCE=streams-index`, the subgraph processor and chain-trigger evaluator now wrap the HTTP source in a `FallbackBlockSource` that falls back to the Postgres tap per-call if api is unavailable, so the data plane keeps advancing instead of stalling during an api outage/rolling deploy. Mixing taps mid-stream is safe (same canonical chain, forward-only cursor); stateless so it's failover-safe across replicas and resumes the HTTP source transparently once healthy.
