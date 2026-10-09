---
"@secondlayer/subgraphs": minor
"@secondlayer/bundler": minor
"@secondlayer/shared": minor
"@secondlayer/cli": minor
---

Derived verification level and pin for every subgraph deploy. Subgraphs whose sources are all state writes (`var_set`, `map_*`) get `verification.level: "state"`: a bundle scan refuses nondeterministic handlers (`Date`, `Math.random`, `fetch`, timers, locale formatting, unbundled imports) with file, line and column, and their handlers run in a `node:vm` realm that throws `NondeterminismError` on the same calls, rejects non-integer numbers in rows, refuses concurrent ctx calls, and aborts the block on read failures. Event sources are `"events"` (verifiable once re-execution proofs ship) and trait or tip-first sources `"none"`; those keep today's execution path and get the findings as advice. `pin` (sha256 over schema hash, bundled handler, startBlock, network and runtime) is stored beside `schema_hash` and shown in deploy output, subgraph detail and `secondlayer subgraphs status`.

**Breaking for some self-hosted subgraphs:** a subgraph on `var_set` / `map_*` sources whose handler uses `Date`, `Math.random`, `fetch`, timers or locale formatting keeps running, but its next redeploy fails with `NONDETERMINISTIC_HANDLER`. Fix: derive those values from `event`, `ctx.block` (`timestamp`, `height`) and `ctx.tx` instead.

**Can change results:** `ctx.findOne` / `ctx.findMany` now read committed rows in insertion order (`ORDER BY _id`). Before, Postgres returned any matching row for a non-unique `findOne` and any order for `findMany`, so a handler relying on that could see a different row after reindex.

**Fix:** a handler-only redeploy (`handler_updated`) now takes effect without restarting the processor. The handler cache was keyed by version, which a handler-only redeploy keeps; it is now keyed by the handler's content, and stored bundles load from a content-addressed `data:` URL.

- subgraphs: `deriveVerification`, `computePin`, `SUBGRAPHS_RUNTIME`, the determinism rules (`@secondlayer/subgraphs/verification`), `NondeterminismError`, `loadDeterministicDefinition`; `deploySchema` stores `pin` and `verification`.
- bundler: `scanHandlerDeterminism`; `bundleSubgraphCode` returns `findings` mapped to source positions.
- shared: `SubgraphVerification`; `pin` and `verification` on subgraph rows, detail and deploy responses (migration `0157`).
- cli: `subgraphs deploy` fails fast on a nondeterministic state-level handler and prints `verification` / `unproven` lines; `subgraphs status` shows `Pin` and `Verification`.
