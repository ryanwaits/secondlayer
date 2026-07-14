# Spike f060 — Sandbox per-block handler execution in the subgraph processor (f049 Stage 2)

- **Finding**: f060 (P1 severity / L effort / HIGH rollout risk for the eventual migration), planned at commit `a7f6a7bc`, 2026-07-04. Stage 2 of the f049 spike (`docs/internal/security/subgraph-isolation-spike.md`); depends on f059 (Stage 1, DONE).
- **Status of this doc**: SPIKE deliverable — design + benchmark + PoC only. **No production import site, `context.ts`, `runner.ts`, or `block-processor.ts` is changed.** `git status` at the end of this spike shows changes only under `docs/` and `spike/f060/`. Founder go/no-go required before any implementation plan is scheduled.
- **Drift check**: re-run at execution time — `runner.ts:494` (`await handler(payload, ctx);`) and `processor.ts:128` (`const mod = await import(handlerImportUrl(...))`) both match the plan's excerpts verbatim. No drift.
- **Benchmark + PoC**: `spike/f060/` (unmerged) — `spike/f060/d1-baseline.ts` (D1), `spike/f060/d2-worker/host.ts` (D2). Run: `bun run spike/f060/d1-baseline.ts` and `bun run spike/f060/d2-worker/host.ts`.

> **Live-risk banner (unchanged from f049)**: until Stage 2 lands, "the shared subgraph processor `import()`s and executes untrusted handler code, in-process, every block, in a process that decrypts every BYO tenant's DB connection string via `SECONDLAYER_SECRETS_KEY`" stays on the known-live-risk list. This is the last of the three f049 sites; f059 closed the other two (bundle-time and deploy-time definition extraction, both now AST-only).

---

## 0. Recap: what's already closed, what's left

f059 replaced `bundleSubgraphCode` and the deploy route's `import()` with AST-only extraction of the `defineSubgraph({...})` literal — neither the API process nor the bundler ever executes user code to read `name`/`sources`/`schema` anymore. That closed sites 1 & 2 from the f049 threat model.

Site 3 is structurally different: handlers are **functions**, and a subgraph is useless if its handlers never run. There is no AST trick that avoids executing them. The current path, verified at dispatch:

1. **`loadSubgraphDefinition`** (`packages/subgraphs/src/runtime/processor.ts:112-147`) writes `sg.handler_code` to disk and `await import(handlerImportUrl(sg.handler_path))` (line 128, cache-busted with `?t=`) whenever `sg.version` changes. The returned `SubgraphDefinition.handlers` are real, live functions, cached in `definitionCache` keyed by subgraph name.
2. **`runHandlers`** (`packages/subgraphs/src/runtime/runner.ts:363-510`) sorts matched events into chain order and, per event, checkpoints the ops queue (`ctx.opsCheckpoint()`, line 446), calls `await handler(payload, ctx)` (line 494), and on throw calls `ctx.rollbackTo(checkpoint)` (line 497) — fix-f040 B6's per-handler atomicity guarantee.
3. **`processBlock`** (`packages/subgraphs/src/runtime/block-processor.ts:213-577`) opens a real DB transaction (`route.dataDb.transaction().execute(async (tx) => {...})`, managed path at lines 417-508, BYO two-phase-commit path at lines 330-413), constructs a `new SubgraphContext(tx, ...)`, calls `runHandlers`, then `ctx.flush()` **inside the same transaction**, producing a `FlushManifest` consumed by `emitSubscriptionOutbox`.
4. **`SubgraphContext`** (`packages/subgraphs/src/runtime/context.ts`, 1045 lines) wraps the live Kysely `Transaction` directly. Handler-facing surface: `insert`/`upsert`/`increment`/`update`/`delete` (synchronous, push onto a local `ops` array — zero I/O until flush), `findOne`/`findMany` (async, issue real SQL against `this.db` **immediately**, then overlay the pending-ops queue for read-your-writes — context.ts:67, load-bearing for accumulator handlers per fix-f040 B1), and `opsCheckpoint`/`rollbackTo` (pure array-length bookkeeping, context.ts:249-263).
5. **`resolveRoute`** (`block-processor.ts:41-60`) → `resolveSubgraphDb(row)` decrypts a BYO tenant's connection string using `SECONDLAYER_SECRETS_KEY` (`packages/shared/src/crypto/secrets.ts`) the first time a subgraph is seen, caches the result. The processor also holds the managed `DATABASE_URL`. **Handlers run in this same process, on every matched event, every block, indefinitely** — a persistent foothold, not a one-shot, in the one process that can decrypt every tenant's secret.
6. **Every other handler-invoking path** — catch-up (`catchup.ts`), backfill/reindex (`reindex.ts`), reorg (`reorg.ts` via `handleSubgraphReorg(blockHeight, loadSubgraphDefinition)`) — routes through the same `runHandlers`/`loadSubgraphDefinition`. Any sandbox has to cover these, not just the live NOTIFY path.

f049's Stage 2 recommendation was a **warm per-tenant worker pool** (keeps Bun; `isolated-vm` was ruled out as primary because it's a V8/N-API native addon incompatible with Bun's JSC runtime), gated on **(a)** a measured per-block latency benchmark and **(b)** sign-off that a scrubbed-env worker + locked-down resolver is sufficient isolation. This spike produces both.

---

## 1. D1 — Baseline benchmark: the current in-process cost

### Methodology

**Real product code, exercised directly** (imported from `packages/subgraphs/src`, not copied or stubbed):

- `generateSubgraphSQL` (`schema/generator.ts`) builds the scratch schema/tables
- `SubgraphContext` (`runtime/context.ts`) — the exact class production uses
- `runHandlers` (`runtime/runner.ts`) — the exact dispatch/sort/checkpoint loop
- **Two of the four scenarios use real, unmodified product example handlers**: `examples/sales-index/subgraph.ts` (`sale` handler — `ctx.insert`) and `packages/subgraphs/examples/contract-deployments.ts` (`deploy` handler — `ctx.upsert`)
- The DB is a real Postgres (`docker-postgres-1`, `127.0.0.1:5440`), and every block runs inside a real `db().transaction()` — the same shape as `block-processor.ts`'s managed-subgraph path

**Synthetic, per the plan's explicit fallback** (there is no live chain data in the local dev DB — verified: `SELECT count(*) FROM blocks/transactions/events` all return 0 on `docker-postgres-1`):

- Block/tx/event *input* is hand-built (`spike/f060/lib/fixtures.ts`) to match the exact `MatchedTx` shape `runHandlers`/`buildEventPayload` expect, including **real hex-encoded Clarity values** (via `@secondlayer/stacks/clarity`'s `serializeCV`/`uintCV`/`standardPrincipalCV`) for the sales-index handler's `function_args`, so its real decode path runs, not a stub.
- Two more scenarios are synthetic worst-case handlers (explicitly permitted by the plan): a **read-heavy accumulator** (2 `findOne` + 2 `increment` per event — the "balance = f(existing)" pattern context.ts:67 calls out) and a **write-only counter** (0 reads, 1 `increment` per event — the fully-batchable case).
- The surrounding `block-processor.ts` plumbing (route resolution, BYO two-phase commit, progress/outbox writes, retry) is **not** exercised.

This is a **component-level measurement** — real ctx, real Postgres transaction, real handler dispatch, synthetic chain input — not a full end-to-end block replay. Labelled as such throughout.

Timing mirrors `block-processor.ts:380-386`'s `handlerMs`/`flushMs` instrumentation exactly (`performance.now()` around `runHandlers` and `ctx.flush()`). Reads/writes are counted via a transparent counting `Proxy` around the real `ctx` instance (`spike/f060/lib/op-counter.ts`) — every call still hits the real method, the proxy only tallies.

5 warmup + 30 measured blocks per scenario, 20 events/block. Reproduce: `bun run spike/f060/d1-baseline.ts`.

### Results (median across 4 runs on one dev machine; ranges show run-to-run variance, not measurement error — this is a shared laptop, not an isolated benchmark rig)

| Scenario | ctx ops/event (reads:writes) | handler ms (median) | flush ms (median) | **total block ms (median)** |
|---|---|---|---|---|
| sales-index (real handler) | 0 : 1 | 0.6 – 0.8 | 0.6 – 2.8 | **2.3 – 7.3** |
| contract-deployments (real handler) | 0 : 1 | 0.07 – 0.17 | 1.2 – 2.8 | **3.1 – 6.7** |
| synthetic read-heavy accumulator | 2 : 2 | 4.9 – 5.3 | 1.4 – 1.6 | **7.2 – 8.0** |
| synthetic write-only counters | 0 : 1 | 0.02 – 0.03 | 1.0 – 1.1 | **1.8 – 1.9** |

Zero handler errors across every run.

### What this shows

- **Handler execution time tracks ctx-op count almost exactly**, not code complexity. The real sales-index handler (Clarity-decode + 1 insert) and the real contract-deployments handler (string ops + 1 upsert) both cost well under 1ms — synchronous ctx writes are free (array push, no I/O). The synthetic read-heavy handler, doing 4 ctx ops (2 reads + 2 writes) instead of 1, costs **~10-70x more handler time**, entirely attributable to the 2 real SQL round trips `findOne` issues per event (context.ts:298-313 — reads are NOT batched, each is `await sql.raw(...).execute(this.db)` immediately).
- **Writes are batchable; reads are not — this is the number the worker-boundary decision turns on.** `insert`/`upsert`/`increment`/`update`/`delete` never touch the DB until `flush()`; `findOne`/`findMany` always do, synchronously with the handler's `await`. A worker boundary that keeps writes local (buffer in the worker, ship home once) pays nothing extra for write-only handlers. A worker boundary that must round-trip every read pays the full RTT cost read-heavy handlers already pay against Postgres today, plus a message-passing tax.
- **`flush()` cost is roughly constant per block (~1-3ms)** regardless of handler read/write mix, dominated by the transaction's own I/O (journal check, statement batching, `_created_at`/`_block_height` bookkeeping) rather than the number of ops — 20 vs 40 ops per block doesn't move it much.

---

## 2. D2 — Worker-pool PoC

### Architecture built

```
HOST (trusted — holds the open Postgres transaction, the master key,
      route resolution)
  │
  │  new Worker(workerEntryUrl, { env: {} })  ← env-scrub is a Bun primitive
  │
  ├─▶ bundle.ts (host-side, esbuild + resolverLockdownPlugin)
  │     bundles the untrusted handler source; any `node:*`, `bun:*`, or bare
  │     npm specifier import becomes a throw-on-evaluation stub AT BUNDLE
  │     TIME — before the artifact ever reaches the worker. Same shape as
  │     the existing production stub-plugin (packages/bundler/src/stub-plugin.ts)
  │     that f049 documented, deny-list instead of rewrite.
  │
  ▼
WORKER (untrusted handler code runs here)
  │
  ├── writes (insert/upsert/increment/update/delete): pushed to a LOCAL ops
  │   array, ZERO round trip — mirrors production's real ctx (these are
  │   synchronous, no I/O, in context.ts too)
  │
  ├── reads (findOne/findMany): postMessage → host executes the real SQL
  │   against the real open transaction → postMessage reply → worker awaits
  │   (preserves ctx.findOne's real async shape)
  │
  ├── per-event checkpoint/rollback: pure array-length bookkeeping over the
  │   worker's own local ops array — mirrors runner.ts:446/497 exactly
  │
  └── end of block: ships the worker's own (already rolled-back-as-needed)
      ops array home in ONE message

HOST, same open transaction: replays the worker's ops onto a REAL
SubgraphContext (`hostCtx.insert(...)`, `hostCtx.increment(...)`, ...) and
calls the REAL `ctx.flush()` — the actual SQL-building/statement-batching
code runs completely unmodified.
```

Files: `spike/f060/d2-worker/{bundle.ts, worker-entry.ts, host.ts, protocol.ts, handler-src/{read-heavy,write-only,hostile}.ts}`. Reproduce: `bun run spike/f060/d2-worker/host.ts`.

### 2.1 Isolation demo — empirically verified, not asserted

`handler-src/hostile.ts` is a handler that tries, at call time: (1) read `process.env.SECONDLAYER_SECRETS_KEY`, (2) `await import("node:fs")` and write an exfil file, (3) `await import("node:child_process")` and `execSync`. Run twice — once as a **control** (worker spawned with default env, i.e. no scrub) and once with **`env: {}`**:

| | control (no scrub) | target (`env: {}`) |
|---|---|---|
| `process.env.SECONDLAYER_SECRETS_KEY` | **leaked** (matches the known fixture value) | `<absent>` |
| `import("node:fs")` | blocked (resolver lockdown) | blocked (resolver lockdown) |
| `import("node:child_process")` | blocked (resolver lockdown) | blocked (resolver lockdown) |

The control run proves the scrub is load-bearing, not a no-op — the same worker code genuinely leaks the secret without `env: {}`. The resolver lockdown is independent of the env scrub (it's a bundle-time transform) and blocks both runs identically.

**A finding worth flagging on its own**: this repo's `.env.local` carries the real dev `SECONDLAYER_SECRETS_KEY`, and **Bun auto-loads `.env.local`** — so `process.env.SECONDLAYER_SECRETS_KEY` was already the real key by the time the harness script started, before any test logic ran. The harness force-overrides it to a known fake value via a real re-exec (`Bun.spawnSync` with an explicit `env`) specifically so the isolation demo has a deterministic value to assert against **and never logs the real key**. Two things follow: (a) this is exactly the ambient-authority failure mode the sandbox is meant to close — any handler in the unscrubbed control path had a live path to the real key, no attack needed; (b) **`process.env` mutation in JS (`process.env.X = "..."`) does *not* propagate to a Bun Worker's default-inherited environment — only the real OS-level environ does.** This was verified with a 6-line standalone script before it was relied on anywhere in the PoC (a JS-mutated var came back `<absent>` in the worker; the same var set via the shell came back leaked). This matters for Stage 2: the scrub must be `env: {}` at `Worker` construction, and cannot be simulated or tested by mutating `process.env` in a unit test — a test needs a real subprocess or a real OS env var to be meaningful.

### 2.2 fix-f040 B6 checkpoint/rollback — empirically verified across the boundary

One of the plan's STOP conditions was "if preserving read-your-writes + fix-f040 checkpoint/rollback across the boundary proves infeasible... STOP." It did not prove infeasible — it was implemented and demonstrated:

`worker-entry.ts`'s `runBlock` handler wraps each event's handler call in the same checkpoint/rollback shape `runner.ts:446-497` uses today, just re-homed onto the worker's local ops array (pure bookkeeping, no I/O, no secrets — safe to duplicate into the sandboxed side). Demo: one block, 5 events, 2 "poisoned" (the read-heavy handler throws *after* queuing the first of its two writes, mirroring "a transfer handler that debits then throws" from fix-f040 B6's own rationale comment in context.ts:257-259).

```
events: 5 (3 clean, 2 poisoned)
ops shipped home: 6 (expected 6 if rollback is clean, 8 if a poisoned event's first write leaked)
errors reported: 2 (expected 2)
no orphaned partial writes from poisoned events : true
error count matches poisoned-event count        : true
```

The poisoned events' first-leg writes did **not** survive in what the worker shipped home. Checkpoint/rollback atomicity holds across the boundary, at least for this pattern.

**Scope honestly**: this PoC's worker-side read-your-writes overlay (`worker-entry.ts`'s `overlayIncrements`) only implements the `increment`-on-matching-key case, which is what both demo handlers exercise. It is **not** a full port of `context.ts`'s `overlayOne`/`overlayMany`/`applyOpToRow` (which also covers `insert`, `update`, `delete`, and the upsert-fallback path). A real implementation should port that logic verbatim — it is pure data transformation with no I/O and no secrets, so it's safe to duplicate into the worker bundle unchanged. `findMany`'s overlay is not implemented in this PoC at all (throws if called) — the two demo handlers never call it.

### 2.3 Boundary overhead — the number the go/no-go turns on

5 warmup + 30 measured blocks, 20 events/block, worker spawned with `env: {}`. Median across 3 runs; ranges again reflect real machine variance, not error bars.

| Scenario | worker handlerMs (median) | host flushMs (median) | **E2E block total (median)** | per-read round trip (median / p99, n=1200) |
|---|---|---|---|---|
| read-heavy (2 findOne + 2 increment/event) | 6.1 – 6.9 | 1.4 – 1.7 | **8.6 – 9.8** | **0.13 – 0.16 / 0.41 – 0.76 ms** |
| write-only (0 reads, 1 increment/event) | ~0.01 | 1.1 – 1.2 | **1.9 – 2.1** | n/a (no reads) |

**Delta vs the D1 in-process baseline, same profile:**

- **write-only: ~0 to +0.2ms/block (≈0-10%)**, within run-to-run noise. This confirms the design premise directly: a handler that never reads pays almost nothing extra for being sandboxed — its writes never cross the boundary until the one batched end-of-block message.
- **read-heavy: roughly +1 to +2ms/block (≈15-25%)** at 40 reads/block (2 reads × 20 events). This is the real, structural cost: **~0.14ms median per-read round trip** (worker `postMessage` → host `sql.raw(...).execute(tx)` → `postMessage` reply), paid once per `findOne`/`findMany` call, serially, because handlers `await` each read before deciding the next write (real production handler code does this too — e.g. "look up existing balance, then increment").

The per-read round-trip figure (~0.14ms median, sub-millisecond p99 except under GC/scheduler noise) is the load-bearing number for D6.

---

## 3. D3 — Target architecture

### 3.1 Secrets relocation

**The literal claim "the processor process holds no `SECONDLAYER_SECRETS_KEY`" needs a precise statement, because something has to decrypt a BYO connection string to actually open it.** The PoC's actual, demonstrated split is the correct target:

- **Route resolution stays host-side.** `resolveRoute`/`resolveSubgraphDb` (`block-processor.ts:41-60`, `secrets.ts`'s `decryptSecret`) continue to run in the **host** thread of the processor — the part that manages the open transaction, resolves the block source, and never executes a byte of tenant-authored code. This is not a retreat from the goal; it is the goal, precisely stated: **no process that executes untrusted code holds the key.** The host and the worker are architecturally different trust domains even though they're both part of "the processor."
- **The worker never sees the key, the connection string, or another tenant's route.** It receives only the `ctx` message protocol (table name + where-clause for reads; op descriptions for writes) — verified empirically in §2.1: `env: {}` at `Worker` construction is a real, load-bearing boundary; a worker spawned without it inherits the real key from the OS environ (not a hypothetical — this repo's own dev key was in scope for the demo).
- **Stretch goal, not required for the threat model f049/f060 actually defend against**: moving decryption to a fully separate service (a "connection broker" the host processor calls over an authenticated internal channel) would reduce blast radius further if the **host** process itself were ever compromised through some *other* vector (not untrusted subgraph code — that's what the worker boundary already closes). That is meaningfully more engineering (a new networked service, its own auth, its own failure mode) for a threat this spike was not asked to cover. Recommendation: **do not build it as part of Stage 2**; revisit only if a future audit specifically targets host-process compromise via a different vector.

### 3.2 The `ctx` membrane

What crosses the boundary, and in which direction, per method:

| `ctx` method | Where it executes | What crosses the boundary |
|---|---|---|
| `insert`/`upsert`/`increment`/`update`/`delete` | **Worker** (buffered) | Nothing, until end-of-block — then the whole ops array, once |
| `findOne`/`findMany` | **Worker calls, host executes** | `{table, where}` out; the raw DB row back — synchronous ctx write ops decided so far stay worker-side and are **not** sent to the host for these reads; the worker overlays its own local ops onto the raw row (read-your-writes, see below) |
| `opsCheckpoint`/`rollbackTo` | **Worker**, over its own local ops array | Nothing — pure bookkeeping, demonstrated in §2.2 |
| `flush()` | **Host only**, never worker | The worker's full ops array (once, end-of-block); host replays each op onto a real `SubgraphContext` bound to the real open transaction and calls the real `flush()` |
| the transaction itself | **Host only, always** | Never crosses — the worker never holds a DB handle of any kind |

**Read-your-writes** (context.ts:67, fix-f040 B1) is preserved by **not** round-tripping the overlay logic — only the base-DB read crosses the boundary; the pure overlay computation (`overlayOne`/`overlayMany`/`applyOpToRow`) runs worker-side against the worker's own ops array, which it already has in full. This was proposed as an open question in the plan ("Can read-your-writes be preserved without a per-read round trip... by buffering writes worker-side and only round-tripping the base DB read?") and the PoC's answer is **yes, for the pattern tested** (§2.2's scope caveat still applies — a real implementation needs the full overlay port, not the PoC's increment-only subset).

**Per-handler checkpoint/rollback** (fix-f040 B6) moves with the ops array — since the ops array lives worker-side, the checkpoint/rollback bookkeeping must too, and does (§2.2). The **event-dispatch loop itself** (today, `runner.ts`'s `runHandlers` — chain-order sort, filter lookup, payload building, the per-event checkpoint/try/catch) should move worker-side as a unit: it's pure logic operating on already-decoded event data (no DB, no secrets), and splitting it across the boundary per-event would mean a round trip per event even for write-only handlers, defeating the whole point. The host's job shrinks to: resolve the route, open the tx, hand the worker a batch of already-matched, already-decoded events, answer `findOne`/`findMany` requests as they arrive, and at the end replay + flush.

**What does NOT move worker-side**: `matchSources`/trait resolution (`resolveTraitContracts`) and block loading (`resolveBlockSource`) stay host-side — they need DB access the worker shouldn't have, and they're the same for every subgraph regardless of handler trust.

### 3.3 Warm per-tenant pool lifecycle

- **One warm worker per *active* subgraph**, not a shared pool with per-invocation binding. Rationale: `loadSubgraphDefinition`'s hot-reload contract (cache-bust on `sg.version` change, `processor.ts:112-147`) maps directly onto "reload the handler module inside this subgraph's worker" — a shared pool would need to re-bundle and re-`init` on every invocation if different subgraphs' handlers can land on the same worker, which defeats the point of a *warm* pool. Per-tenant workers also mean a hung/OOMing handler only ever affects its own subgraph's block cadence, not a neighbor's — this is the isolation property `DEFAULT_CONCURRENCY = 5` (processor.ts:41) already assumes at the process level (5 subgraphs' catch-up runs concurrently today; the per-tenant worker model is the same shape one level down).
- **Spawn**: lazily, on first block a subgraph needs processed (or eagerly at processor startup for subgraphs already `status = 'active'`, to avoid a cold-start tax on the very first live block after a deploy).
- **Reuse**: keep the worker alive across blocks; `init` only re-runs on a version change (mirrors `knownVersions`/`definitionCache` in `processor.ts:104-105`).
- **Hot-reload**: version bump → bundle the new `handler_code` (esbuild + resolver lockdown, host-side, same as today's `sg.handler_code` → disk → `import()` flow) → `postMessage({type:"init", ...})` to the *existing* worker rather than spawning a new one, unless the worker is judged unhealthy (see crash recovery) — cheaper than a fresh spawn, and this is exactly `invalidateSubgraphRoute` + cache-bust's existing contract, just retargeted at a worker instead of a module cache entry.
- **Crash recovery**: a handler that hangs needs a **per-block timeout** at the host (the host is already `await`ing a `blockDone` message; wrap it in `Promise.race` against a deadline) — on timeout, `worker.terminate()` and respawn, then retry the block (same retry contract `processBlockWithRetry`, `block-processor.ts:185-211`, already provides — no change needed there, the worker failure just becomes another transient error in that existing retry loop). A worker that OOMs terminates itself (Bun surfaces this as the worker exiting); the host's message-wait promise needs an `onerror`/exit handler wired to the same timeout-and-retry path, not just the timeout branch.
- **Backpressure**: bounded by `DEFAULT_CONCURRENCY` today at the subgraph-fan-out level (`processor.ts:41`); a worker per active subgraph multiplies that by "one worker" rather than "one in-process call," so the operational question becomes **memory** at fleet scale (below), not scheduling — the host's event loop is not blocked by a worker computing (that's the point), so concurrency doesn't need new bounding beyond what already exists.
- **Memory cost at fleet scale**: each Bun `Worker` is a full JS heap+thread, not free (Bun's own `smol: true` `WorkerOptions` exists specifically because worker memory is a known concern). At fleet-active-subgraph counts in the tens-to-low-hundreds, per-tenant warm workers are very plausibly fine; this spike did not measure per-worker resident memory, and a production plan should before assuming it scales to "one worker per active subgraph" at whatever the fleet's actual active-subgraph count is. **Flagged as a required pre-implementation measurement**, not answered here.

### 3.4 Coverage of all paths

Catch-up (`catchup.ts`), backfill/reindex (`reindex.ts`), and reorg (`reorg.ts`) all route through `runHandlers`/`loadSubgraphDefinition`, same as the live path — none of them have a *separate* handler-execution mechanism to sandbox. The worker-pool model holds structurally for all three, with two things worth calling out:

- **Reindex throughput**: reindex processes many blocks back-to-back with no live-tip pacing, so it's the stress case for the per-block worker round trip. D1/D2 didn't measure reindex-mode throughput specifically (both benchmarks process blocks sequentially at whatever the local machine can do, which is closer to a reindex access pattern than a live-tip one already) — the read-heavy delta (~15-25% per block) is the right number to extrapolate from for a throughput regression estimate, but a dedicated reindex-throughput benchmark (many more blocks, no artificial warmup/measured split) is recommended before Stage 2 implementation, not assumed from this spike.
- **Reorg replay**: `handleSubgraphReorg` rewinds via the `_journal` table and replays — this happens host-side today (journal reads/writes are `ctx`-internal, `context.ts:656-719`) and stays host-side under the target architecture; nothing about reorg replay requires re-*running* handler code inside the worker beyond the same per-block path already covered.

---

## 4. D4 — Bun vs Node decision

**Confirmed: Bun `Worker` + bundle-time resolver lockdown is a real, empirically-demonstrated boundary for this threat model.** §2.1 is not a claim, it's a measurement: a hostile handler in a scrubbed worker got `undefined` for the secret and a thrown error for both `node:fs` and `node:child_process`, while the same code in an unscrubbed control worker leaked the (fixture) secret — proving the scrub is load-bearing, not decorative. This validates the f049 spike's Option B recommendation over Option A (`isolated-vm`), which remains **ruled out** for the same reason as before: it's a V8/N-API native addon, incompatible with Bun's JSC runtime, and would force the processor onto Node — a second migration bundled into this one. No new information from this spike changes that call.

**Caveat, stated plainly**: a Bun `Worker` shares the host's JS engine (JSC) — it is a real thread/heap boundary with a scrubbed env and a locked-down resolver, not a hardware-virt boundary like `isolated-vm`'s V8 isolate or a microVM. The f049 spike scored this "3-4" on isolation strength, not "5," for exactly this reason: a sufficiently novel JSC engine bug or a gap in the resolver lockdown (e.g., an import form this PoC's plugin doesn't intercept) is a theoretically larger attack surface than a hardware boundary. This spike did not attempt to find such a gap (that would be a dedicated red-team exercise, out of scope here) — it demonstrates the two specific, named threats from f049's threat model (env secrets, node builtins) are blocked, not that the boundary is unconditionally unbreakable. Recommend a follow-up adversarial review of the resolver lockdown specifically (fuzz import forms: dynamic `import()` with computed specifiers, `require()` shims, `WebAssembly`, `Function` constructor tricks) before treating Stage 2 as closing the finding completely.

---

## 5. D5 — Migration path + rollback

Staged, shadow-runnable, mirroring f059's flag posture (`SUBGRAPH_UNSAFE_IMPORT_EVAL`):

**Stage 2a — Build the worker pool behind a flag, dark.** Implement the host/worker split from §3 as a genuinely separate code path from today's in-process `runHandlers` call in `block-processor.ts`. A new flag (e.g. `SUBGRAPH_SANDBOX_WORKERS=1`, per-subgraph override in the `subgraphs` table for a gradual per-tenant rollout) selects the path; default **off**. No behavior change when off.

**Stage 2b — Shadow-run against a subset of subgraphs.** For flagged subgraphs, run the worker path in parallel with the in-process path on the same blocks (extra cost, deliberately, for validation only) and **diff the flush manifests** (`FlushManifest.writes`, `context.ts:35-38`) byte-for-byte — same op, same table, same row, same pk. Any divergence blocks rollout; this catches overlay-porting bugs (§2.2's scope caveat is exactly the kind of gap this would surface) before they touch real tenant data. Run shadow mode across catch-up, backfill, reindex, and at least one observed reorg before trusting the diff.

**Stage 2c — Cutover per subgraph.** Once shadow-diff is clean for a subgraph across a representative window (including at least one reorg if the subgraph has seen one), flip its flag to make the worker path authoritative — stop double-running, worker path writes for real.

**Stage 2d — Remove the master key from the processor's untrusted-code-adjacent surface last, after Stage 2c is proven at full traffic.** Per the target architecture (§3.1), this doesn't mean *deleting* the key from the "processor" as a deployable — it means confirming, by the time this stage is reached, that the key is provably reachable only from the host thread that never executes tenant code, and rotating it (secrets.ts's rotation checklist, same as f049's §7) as the closing step.

**Rollback**: flip the flag back to in-process execution — global, or per-subgraph. Because Stage 2a is additive (new path, old path retained behind the flag) rollback is instant with no schema/data change, *as long as Stage 2d (key removal) hasn't happened yet* — which is exactly why key removal is ordered last. If a subgraph's worker path has already fully cut over (Stage 2c) and a bug surfaces, rollback to in-process still works as long as the key hasn't been rotated away from what the in-process path expects.

---

## 6. Open questions — answered

**What is the measured read/write ctx-op ratio for real subgraphs, and does the worker boundary fit the per-block budget at tip? During reindex (throughput)?**
Both real example handlers are 0 reads : 1 write per event — fully batchable, ~0 measured overhead (§2.3). The synthetic read-heavy profile (2:2) shows ~15-25% per-block overhead at 20 events/block, driven entirely by the ~0.14ms median per-read round trip. Whether real deployed subgraphs skew toward the sales-index/contract-deployments shape (write-mostly) or the accumulator shape (read-heavy) is not something this spike can answer without a survey of actual `handler_code` in the `subgraphs` table — **recommended as a pre-Stage-2-implementation step**: sample real tenant handlers' `findOne`/`findMany` call counts to calibrate expected fleet-wide overhead, rather than assuming either synthetic profile is representative. Reindex throughput specifically was not separately benchmarked (§3.4) — flagged, not answered.

**Can read-your-writes be preserved without a per-read round trip — e.g. by buffering writes worker-side and only round-tripping the base DB read, or by prefetching? What breaks if reads are served from a host-side snapshot?**
Yes, for the scope tested (§2.2, §3.2) — writes stay worker-side, only the base row round-trips, and the worker overlays its own pending ops before returning to the handler. A host-side snapshot (read the row once, cache it, serve subsequent reads from cache without re-hitting Postgres) was considered and **not** implemented in this PoC: it would break correctness the instant two *different* worker-issued writes both need to observe the *other's* effect on a shared key within one block via the DB — which read-your-writes' overlay-not-snapshot design already avoids by re-reading fresh base state per call and layering local writes on top. A snapshot would need its own invalidation logic to stay correct and wasn't worth the complexity for a boundary that's already sub-millisecond per read.

**Does moving the tx host-side and the handler worker-side keep fix-f040's per-handler checkpoint/rollback atomicity intact?**
Yes — empirically demonstrated in §2.2, not just argued. Scope caveat: the demo covers the `increment` pattern; a production port needs the full `overlayOne`/`overlayMany`/`applyOpToRow` logic, and Stage 2b's shadow-diff is exactly the mechanism to catch a gap there before it matters.

**Is a Bun `Worker` env-scrub + resolver lockdown a real boundary, or can a handler still reach ambient authority?**
Real, for the two named threats (env secrets, node builtins) — confirmed empirically with a leak/no-leak control pair (§2.1). Not proven unconditionally unbreakable; see §4's caveat and recommended follow-up adversarial review.

**Pool sizing: one warm worker per active subgraph, or a shared pool with per-invocation tenant binding? Memory cost at the fleet's active-subgraph count?**
Recommend one warm worker per active subgraph (§3.3) — cleanest mapping onto the existing hot-reload/cache-invalidation contract and the strongest crash-isolation property. Memory cost at fleet scale is **not measured** in this spike and should be a required pre-implementation step, not an assumption.

---

## 7. D6 — Go / no-go

### Per-block budget

There is no in-repo constant for Stacks block interval to anchor a budget to directly, so this derives from the processor's own operational parameters instead: `POLL_INTERVAL_MS = 5_000` (`processor.ts:43`) is the outer bound the processor already tolerates for catch-up staleness on a NOTIFY miss, and `DEFAULT_CONCURRENCY = 5` (`processor.ts:41`) means up to 5 subgraphs' catch-up work can run concurrently in one process today. A conservative per-block budget for handler+flush: **comfortably under 100ms**, to leave wide headroom inside the 5-second poll window even under concurrent load and occasional slow blocks (busy blocks, cold caches, GC pauses).

### The numbers against that budget

- D1 baseline (current, in-process): **1.8 – 8.0ms** per block across all four profiles, component-level.
- D2 worker path: **1.9 – 9.8ms** per block across the two benchmarked profiles, component-level.
- Worst measured delta (read-heavy profile, 40 reads/block): **+15-25%**, roughly **+1 to +2ms/block** in absolute terms.

Both the baseline and the worker path sit **1-2 orders of magnitude under** the derived 100ms budget. The worker boundary's overhead, even for the least favorable (read-heaviest) profile measured, is a low-single-digit-millisecond addition to an already-low-single-digit-millisecond baseline. This is not a marginal call.

### Recommendation

**GO — staged, founder-approved, per §5.** Concretely:

1. **The core sandbox mechanism is validated by this spike**, not just designed: env-scrub + resolver-lockdown genuinely blocks the two named threats (§2.1), fix-f040 checkpoint/rollback survives the boundary for the pattern tested (§2.2), and the boundary overhead is small relative to any plausible per-block budget (§2.3, above) — none of the plan's STOP conditions triggered.
2. **Schedule Stage 2a (build behind a flag) as a separate, risk-reviewed implementation plan.** It touches the per-block hot path and needs its own review of the flush/reorg transaction structure per fix-f040's existing scrutiny bar — this spike's PoC is a boundary prototype, not production code, and should not be lifted directly into `packages/`.
3. **Before implementation starts**, do the two measurements this spike flagged as required and did not do: (a) survey real tenant `handler_code` for actual read/write ctx-op ratios (calibrates expected fleet-wide overhead against the synthetic profiles here), and (b) measure per-`Worker` resident memory at a realistic warm-pool size (calibrates §3.3's "one worker per active subgraph" against actual fleet active-subgraph counts).
4. **Port `context.ts`'s full overlay logic (`overlayOne`/`overlayMany`/`applyOpToRow`) into the worker-side membrane** rather than reimplementing a subset — this spike's PoC intentionally narrowed scope to the pattern its two demo handlers use (§2.2's caveat); production needs the complete, unmodified algorithm, and Stage 2b's shadow-diff against the in-process path is the safety net if a gap remains.
5. **Recommend a follow-up adversarial review of the resolver lockdown** (§4) before treating this finding as fully closed — this spike proved the two named threats are blocked, not that the boundary is exhaustively hardened against every import-obfuscation form.
6. **Rotate `SECONDLAYER_SECRETS_KEY`** remains a founder operation, independent of this code timeline, per f049's §7 checklist — unchanged by this spike.

**No-go conditions to watch, going into Stage 2a**: if the pre-implementation handler survey (item 3a) finds real tenant handlers are dramatically more read-heavy than this spike's synthetic worst case (e.g. 10+ reads/event, not 2), re-run D2's benchmark against that profile before committing to the worker design — the ~0.14ms per-read cost scales linearly and a large enough read count could change the budget conversation. Nothing measured in this spike suggests that's likely, but it wasn't ruled out either.

---

## 8. Related / notes

- **f049** (`docs/internal/security/subgraph-isolation-spike.md`) is the parent spike — Stage 1 (AST-only extraction, sites 1 & 2) is DONE; this doc is Stage 2 (site 3, per-block handler execution).
- Until Stage 2a-d land and the key is rotated, "the shared processor executes untrusted handler code in-process every block, holding the master key" stays on the known-live-risk list — this spike does not close the finding, it clears the path to close it.
- **Out of scope for this spike (not done here, called out above as follow-up work)**: no product code was modified; no secret was rotated; reindex-throughput-specific benchmarking; per-`Worker` memory measurement; a real tenant `handler_code` read/write ratio survey; an adversarial resolver-lockdown review; the full `overlayOne`/`overlayMany`/`applyOpToRow` port.

---

## 9. Stage 2a preconditions (measured 2026-07-14, before implementation)

Plan f071 (Stage 2a) gates its build on three measurements this spike flagged
as required and did not take. Done here, against the real local dev DB and
the real `app-server` production host (read-only queries only — no product
code changed, no secret touched). None tripped a STOP condition; the plan
proceeded to the build.

### 9a. Real handler read/write-ratio survey

**Corpus available**: the local dev DB's `subgraphs` table (`127.0.0.1:5440`,
after `bun run db` + `bun run migrate`) has **0 rows** — there is no live BYO
tenant `handler_code` reachable from this environment. Per the plan's explicit
fallback, the survey instead used every real, committed subgraph-handler
source in the monorepo:

- Four **hosted-production** subgraphs, each explicitly documented in its own
  file header as recovered verbatim from the deployed source-capture (i.e.
  this file content **is** what's stored in `subgraphs.handler_code` in prod
  for these four): `subgraphs/sbtc-flows.ts`, `subgraphs/pox-stacking.ts`,
  `subgraphs/bns-names.ts`, `subgraphs/contract-deployments.ts`.
- Product example/skill handlers: `examples/sales-index/subgraph.ts`,
  `packages/subgraphs/examples/contract-deployments.ts`,
  `skills/secondlayer/examples/{minimal-subgraph,contract-events,sip010-balances}.ts`,
  `scripts/seed-balances/{sbtc,alex,usdcx}-balances.ts`,
  `bench/subgraphs/sbtc-flows-bench.ts`.
- A repo-wide `grep` for `ctx.findOne`/`ctx.findMany` outside tests/spike
  confirmed there is exactly **one** place in the whole monorepo where a real
  (non-test, non-spike) handler reads via `ctx`: the CLI scaffold template
  (`packages/cli/src/templates/subgraph.ts:205`, the generated "balances"
  starter every `secondlayer subgraph create --template balances`-style flow
  hands a new user).

**Findings**:
- All four hosted-production subgraphs and every example/skill/seed handler
  found are **0 reads : N writes per event** — `insert`/`upsert`/`update`/
  `increment` only, never `findOne`/`findMany`. This matches D1's own finding
  that the two real example handlers it benchmarked were 0:1.
- The one read-using real pattern in the repo, the CLI scaffold's `adjust()`
  helper, does `1 findOne + 1 upsert` per touched party, and a `transfer`
  event touches both sender and recipient — so its worst case is **2 findOne
  + 2 upsert per event**, matching (not exceeding) the spike's own synthetic
  "read-heavy accumulator" profile (2 findOne + 2 increment/event) almost
  exactly. That profile was already benchmarked in §2.3 at ~+15-25%/block
  (~+1-2ms), 1-2 orders of magnitude under the ~100ms budget derived in §7.

**Conclusion**: no material fraction of real handlers found are read-heavy
enough to blow the budget — the one read-using real-world pattern found is
already covered by the spike's own worst-case benchmark. **Not a STOP.**
Stated limit: this is a thin, self-hosted-and-example corpus (4 production +
~9 example/template files), not a sample of actual third-party BYO tenant
`handler_code` — none was reachable from this environment (local DB empty,
no cross-tenant prod handler-code access attempted). This is a documented
estimate, not a claim about the full BYO fleet's handler shape; re-survey
once real BYO tenants with custom handlers exist.

### 9b. Per-worker resident memory at fleet scale

**Fleet's actual active-subgraph count** (read-only query, `app-server`,
`secondlayer-postgres-platform-1` / `secondlayer_platform` DB,
`SELECT status, count(*) FROM subgraphs GROUP BY status`): **5 active**
subgraphs today (matches the four hosted-production subgraphs above plus one
more).

**Measurement**: esbuild-bundled the four real hosted-production subgraph
files (`bundleForBench`, same resolver-lockdown shape as `bundle.ts` plus a
stub for `@secondlayer/subgraphs`'s `defineSubgraph` so the real files
evaluate without needing the runtime package) and loaded each into its own
warm Bun `Worker({ env: {} })`, mirroring §3.3's "one warm worker per active
subgraph, reused across blocks, idle between blocks" — then measured host
process RSS delta as workers were added incrementally (1 → 5 → 10 → 20 → 40 →
60), on this dev machine (Bun v1.3.10, macOS arm64):

| workers | total RSS | delta from 0-worker baseline | avg marginal MB/worker |
|---|---|---|---|
| 1 | 53.98 MB | 7.63 MB | 7.63 |
| 5 | 77.25 MB | 30.89 MB | 6.18 |
| 10 | 106.52 MB | 60.16 MB | 6.02 |
| 20 | 163.81 MB | 117.45 MB | 5.87 |
| 40 | 280.52 MB | 234.16 MB | 5.85 |
| 60 | 385.14 MB | 338.78 MB | 5.65 |

Marginal cost converges to **~5.6-6MB per idle warm worker** holding a real
bundled handler module. (Note: an earlier pass summing each worker's own
self-reported `process.memoryUsage().rss` gave a misleading ~80MB/worker
figure — `process.memoryUsage()` reports whole-process RSS regardless of
which thread calls it in Bun, confirmed empirically when every worker
reported the same value as the host's total; the host-side delta-over-N
measurement above is the correct signal.)

**Fleet-scale check**: `app-server` has 62GiB total RAM, 57GiB available
(`free -h`); the live `secondlayer-subgraph-processor-1` container currently
uses ~79MiB RSS. At the fleet's actual N=5, one-warm-worker-per-subgraph costs
~30MB. Even at the spike's own stated outer bound ("tens-to-low-hundreds"),
150 workers × ~6MB ≈ 900MB — under 2% of available RAM.

**Conclusion**: one warm worker per active subgraph is not infeasible at any
scale this fleet is plausibly near. **Not a STOP.**

### 9c. Reindex-throughput benchmark

Phase 3-4 (the real worker runtime) don't exist yet at measurement time, so
per the plan's explicit allowance this used the f060 D2 PoC (`spike/f060/
d2-worker/`) as a throughput proxy against the D1-style in-process path, both
driven through the *same* real `SubgraphContext`/`generateSubgraphSQL`
machinery, over **300 blocks back-to-back with no tip pacing and no warmup/
measured split** (the reindex access pattern) at 20 events/block, for both
the write-only and read-heavy synthetic profiles. Two independent runs:

| profile | run | in-process | worker-path (PoC proxy) | regression |
|---|---|---|---|---|
| write-only | 1 | 390.5 blocks/sec | 422.3 blocks/sec | **-8.1%** (worker faster) |
| write-only | 2 | 400.1 blocks/sec | 457.4 blocks/sec | **-14.3%** (worker faster) |
| read-heavy | 1 | 114.0 blocks/sec | 121.4 blocks/sec | **-6.5%** (worker faster) |
| read-heavy | 2 | 144.2 blocks/sec | 123.0 blocks/sec | **+14.7%** (worker slower) |

**Conclusion**: regression sign flips between runs and stays single-digit-to-
low-teens percent either way — consistent with the doc's own framing
elsewhere ("a shared laptop, not an isolated benchmark rig"), not a
systematic, operationally-significant throughput regression. No run showed
anything close to a multiple-x slowdown. **Not a STOP.** This remains a
component-level proxy (real ctx/DB/dispatch, PoC worker plumbing, synthetic
chain input) — Step 6/7's coverage tests are the place a real Phase 3-4
reindex-mode regression would first show up structurally; re-benchmark with
the production worker runtime once built if reindex operational cost becomes
a concern.

**Net Phase 0 result: no STOP condition triggered. Proceeding to the Step
1-7 build.**

---

## 10. STOP at Step 7 — the Bun Worker substrate does NOT isolate untrusted code (2026-07-14)

**Status: the Stage 2a build is STOPPED at the isolation-regression gate.**
Steps 1-6 were built and pass their correctness gates (flag/column/overlay
parity/host-membrane block parity/catch-up-reindex-reorg coverage — all
green). Step 7's isolation regression test — the security lock the whole
staged sandbox exists to satisfy — **fails fundamentally**, and the reason
is not a fixable bug in this plan's code: **a Bun `Worker` cannot isolate
untrusted handler code from the master key.** This invalidates D4's core
conclusion ("Bun `Worker` + resolver lockdown is a real boundary for this
threat model") and, by extension, the go/no-go premise of Stages 2b-2d.

### What the f060 spike's isolation demo actually tested — and what it missed

The spike's `handler-src/hostile.ts` fixture probed exactly three things:
(1) `globalThis.process.env.SECONDLAYER_SECRETS_KEY`, (2) `import("node:fs")`,
(3) `import("node:child_process")`. All three are genuinely blocked by
`env: {}` + the resolver lockdown, and the demo reports `<absent>` /
blocked — **truthfully, for those three access forms.** But a hostile
handler is not limited to those three forms, and the spike never probed the
others. Three empirically-verified bypasses (Bun v1.3.10, macOS arm64, and
the same via a re-exec'd process with a fake key in the real OS environ):

1. **Bare `process.env.X` bypasses the env scrub.** `env: {}` scrubs
   `globalThis.process.env` and `Bun.env` and the enumeration of
   `process.env` (`Object.keys(process.env).length === 0` in the worker),
   but the **bare `process.env.SECONDLAYER_SECRETS_KEY`** binding still
   returns the real value — it resolves to a live `getenv()`-backed binding
   that is immune to the Worker `env` option AND to mutating/replacing
   `globalThis.process`. The spike's fixture used the `globalThis.process`
   form (scrubbed), so it never saw this. A banner-injected module-scope
   `const process = { env: {} }` in the esbuild bundle DOES shadow the bare
   identifier — but that only closes vector 1, not vector 3.

2. **`Bun.file(path).text()` — arbitrary filesystem read.** The ambient
   `Bun` global exposes `Bun.file`, which reads any path the host process
   can (another tenant's on-disk `handler_path`, secrets on disk, etc.).
   No import, so the resolver lockdown never sees it.

3. **`Bun.spawnSync({cmd})` — arbitrary command execution that reaches the
   HOST process environ.** The Worker is a *thread inside the host process*;
   `Bun.spawnSync` spawns a child that inherits the **host** process's real
   OS environment (not the Worker's `env: {}` scrub), so
   `Bun.spawnSync({cmd:["/bin/sh","-c","echo $SECONDLAYER_SECRETS_KEY"]})`
   prints the master key. Verified end-to-end: in a fully-scrubbed worker
   (`env: {}` + bundle banner shadowing `process`/`Bun` + `globalThis.process`
   replaced), `Bun.file()` still read a canary file and `Bun.spawnSync` still
   printed a fake `EXFIL_SECRET` set only in the host's environ.

**`globalThis.Bun` cannot be removed.** Its property descriptor on
`globalThis` is `{ configurable: false, writable: false }` — `delete
globalThis.Bun` is a silent no-op, and both `globalThis.Bun = undefined` and
`Object.defineProperty(globalThis, "Bun", …)` throw
`Attempted to assign to readonly property`. The esbuild banner can shadow the
*bare* `Bun` identifier inside the handler bundle, but a handler that writes
`globalThis.Bun.spawnSync(...)` reaches the real, un-shadowable global. There
is no worker-side or bundle-side scrub that closes this within the Bun `Worker`
model — the capability is an intrinsic, non-configurable property of every Bun
JS context.

### Why this is a STOP and not a patch

The entire staged plan (2a build → 2b shadow-diff → 2c cutover → 2d remove
the master key) is predicated on the worker being a trust boundary that keeps
untrusted handler code away from `SECONDLAYER_SECRETS_KEY`. It is not. Wiring
a flag-selectable "sandbox" that a hostile handler escapes in one
`globalThis.Bun.spawnSync` line would be **security theater** — worse than the
current honest state, because a future operator (or Stage 2d) could remove the
key believing the worker contains the code it does not. The isolation gate
existing precisely to catch "is the scrub load-bearing?" did its job: the
answer, for a Bun `Worker`, is **no**.

### What this changes (founder decision)

- **D4 must be revisited.** `isolated-vm` was ruled out in f049/f060 because
  it's a V8/N-API addon incompatible with Bun's JSC runtime — but that
  trade-off assumed the Bun `Worker` was a real boundary. It is not, so the
  comparison has to be re-run honestly. Real options that actually contain
  untrusted code, each a larger change than this plan assumed:
  - **A separate OS process per tenant** (Bun/Node subprocess with a
    genuinely scrubbed environ AND no inherited fds/secrets), reached over an
    IPC channel — the host-answers-reads / replay-ops membrane built here
    (`overlay.ts`, the protocol, the host replay) ports to a subprocess
    boundary largely unchanged; only the transport (`Worker.postMessage` →
    IPC) and the spawn/scrub change. This is the most likely path.
  - **`isolated-vm` on a Node processor** — a real V8-isolate boundary, but
    forces the processor off Bun (a second migration), which is why f049
    deferred it.
  - **A container/microVM per tenant** (gVisor / Firecracker) — strongest
    isolation, largest operational cost.
- **f049 site 3 stays open and on the known-live-risk list**, unchanged:
  "the shared subgraph processor executes untrusted handler code in-process,
  every block, holding the master key." This stage did not, and on this
  substrate cannot, build the machine that closes it.

### Disposition of the Stage 2a build

- **The flag-gated dispatch was NOT wired into `block-processor.ts`'s
  production hot path** (the Step-5 edit was reverted): the in-process path
  is byte-identical to before, so nothing ships a selectable non-isolating
  sandbox. `runHandlersSandboxed` has no production caller.
- The `packages/subgraphs/src/runtime/sandbox/` modules (bundle / protocol /
  overlay / worker-ctx / worker-entry / host) and their correctness tests
  are left **unwired** as investigation artifacts — `overlay.ts` (the verbatim
  `context.ts` overlay port) and the host-membrane/replay design are
  substrate-independent and are the reusable core for whichever real
  isolation substrate is chosen. `isolation.test.ts` is a **green regression
  lock that asserts the break** (proves `env: {}` + resolver lockdown do NOT
  contain `globalThis.Bun` / bare `process.env`), so the finding stays
  enforced in CI and nobody re-adopts the substrate assuming it isolates.
- The dark `sandbox_workers` column + `sandboxEnabled` resolver (migration
  0109) remain as control-plane opt-in prep — reusable by any redesigned
  sandbox — but are wired to nothing.

**Net Stage 2a result: STOPPED at the isolation gate. The correctness
scaffolding is built and green; the security substrate is disproven. Next
step is a founder-level isolation-substrate decision, not a continuation of
this plan on Bun `Worker`s.**
