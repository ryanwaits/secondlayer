---
"@secondlayer/subgraphs": patch
---

Add dark, unwired sandbox handler-execution scaffolding under `runtime/sandbox/` (host membrane, worker entry, protocol, bundler resolver lockdown, and a verbatim port of the `context.ts` read-your-writes overlay), plus an `esbuild` dependency for host-side handler bundling. Nothing is reachable from the production block-processor path — the flag-gated dispatch was intentionally not wired in. The Bun `Worker` isolation substrate was disproven at the security gate (a hostile handler escapes via `globalThis.Bun` / bare `process.env`); these modules remain as the substrate-independent correctness core for a future, real isolation substrate. See `docs/internal/security/subgraph-processor-sandbox-spike.md` §10.
