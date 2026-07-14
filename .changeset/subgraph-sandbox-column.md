---
"@secondlayer/shared": patch
---

`subgraphs` gains a `sandbox_workers BOOLEAN NOT NULL DEFAULT FALSE` column (migration 0109) — the per-subgraph opt-in for a future sandboxed handler-execution path. Dark and wired to nothing in this release (default false everywhere); it exists as control-plane opt-in prep. See `docs/internal/security/subgraph-processor-sandbox-spike.md` §10.
