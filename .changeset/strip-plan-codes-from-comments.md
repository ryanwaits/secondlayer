---
"@secondlayer/shared": patch
"@secondlayer/cli": patch
"@secondlayer/platform": patch
"@secondlayer/api": patch
"@secondlayer/indexer": patch
"@secondlayer/subgraphs": patch
---

Comment-only cleanup, no behavior change: reworded `packages/platform/src/billing/prices.ts`'s stale "not wired to a caller yet" note for the hosted-stack meters (the workload host flushes them to `/internal/meters`), and stripped `plan-NNN`/`design-fNNN` references from code comments across `shared`, `cli`, `platform`, plus `api`, `indexer`, and `subgraphs` — those numbers point at gitignored local planning docs, meaningless to anyone reading the comment later. Left the `f0NN` audit-finding codes (e.g. `fix-f040`, `f068`) alone — those are backed by permanent, git-tracked docs (`docs/internal/audits/`, package changelogs), a different and legitimate documentation convention.
