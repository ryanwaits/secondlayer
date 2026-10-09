---
"@secondlayer/subgraphs": minor
"@secondlayer/bundler": minor
"@secondlayer/shared": minor
"@secondlayer/cli": minor
---

Derived verification level and pin for every subgraph deploy. Subgraphs whose sources are all state writes (`var_set`, `map_*`) are `L2`: a bundle scan refuses nondeterministic handlers (`Date`, `Math.random`, `fetch`, timers, locale formatting, unbundled imports) with file, line and column, and their handlers run in a `node:vm` realm that throws `NondeterminismError` on the same calls, rejects non-integer numbers in rows, refuses concurrent ctx calls, and aborts the block on read failures. Every other subgraph keeps today's execution path and gets the findings as advice. `pin` (sha256 over schema hash, bundled handler, startBlock, network and runtime) is stored beside `schema_hash` and shown in deploy output, subgraph detail and `secondlayer subgraphs status`.

- subgraphs: `deriveVerification`, `computePin`, `SUBGRAPHS_RUNTIME`, the determinism rules (`@secondlayer/subgraphs/verification`), `NondeterminismError`, `loadDeterministicDefinition`; `deploySchema` stores `pin` and `verification`.
- bundler: `scanHandlerDeterminism`; `bundleSubgraphCode` returns `findings` mapped to source positions.
- shared: `SubgraphVerification`; `pin` and `verification` on subgraph rows, detail and deploy responses (migration `0157`).
- cli: `subgraphs deploy` fails fast on a nondeterministic `L2` handler and prints `verifiable` / `unproven` lines; `subgraphs status` shows `Pin` and `Verifiable`.
