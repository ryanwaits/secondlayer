# AGENTS.md

Operating instructions for AI coding agents working in this repo. Read this and
`STRATEGY.md` first, every session.

---

## Working agreements

### Parity firewall (load-bearing)

A new capability ships **REST route + OpenAPI entry first**. SDK and CLI wrappers
follow where they earn their place, generated where possible; MCP stays
golden-path only. Releases go out as changesets when ready.

### Frozen periphery

index stacking/mempool extras, the stacks-SDK wallet half (except nonce coordination — supported, see
packages/stacks/README.md), webhooks format expansion. Shipped code stays; no
new investment, no docs prominence. Being on this list is never grounds to
delete; that takes usage or dead-code evidence. Unfreeze requires a named
external request.
Nonce coordination is the carved-out exception: demand-validated (named external
request), supported, documented.

### Scope discipline

- OSS `/v1` reads are keyless on a loopback publish; `INSTANCE_TOKEN` gates
  writes and every `/v1` request once the API is reachable past loopback.
  Hosted `/v1` (api.secondlayer.tools) is keyed: `Authorization: Bearer`
  with an account key (`sk-sl_*`, env `SECONDLAYER_API_KEY`). Same prepaid credits
  as archive bootstrap. Do not add accounts on OSS. Do not add hosted
  keyless reads.
- Cursor format and public `/v1` envelope are 1.0 contracts; reorg/cursor tests
  are sacred.
- Decoders read Streams' reader in-process; the HTTP Streams path is guarded by the HTTP == in-process parity test (`packages/api/src/streams/decode-dogfood.test.ts`). Do not break either. (The 11 classic decoders — `packages/indexer` l2 module — moved in-process; sbtc/pox4/pox5/bns still read over HTTP until their own pass.)
- Never describe product surfaces as L1/L2/L3 layers in docs or comms — Stacks is itself a Bitcoin L2, so the terms confuse users. Say raw (Streams), decoded (Index), your schema (Subgraphs). This also extends to code: no identifier, env var, service, or table may start with `l2`/`layer2`. The decoder service is `decoder` (image `secondlayer-decoder`), the dir is `packages/indexer/src/decode/`, checkpoints are named `decode.<event_type>.v<major>`, and the checkpoint table is `decoder_checkpoints`.
- No EVM/multi-chain. No new wallet-side primitives beyond nonce coordination (supported) and what's already frozen.

### State machines

- States = one const array in the owning package, mirrored by a DB CHECK.
- Transitions = a `defineMachine` table next to the states (`packages/shared/src/db/transition.ts`).
- Every status write goes through `casTransition`; `null` = lost race, log and stop. `scripts/ci/status-writes.ts` fails CI on new raw `.set({ status:` / `SET status` sites (baseline file; shrink it, never grow it).
- Derived states ("is live", "is down", "caught up") = one exported pure fn, no inline copies.

### Process

- Work directly on `main`; push only when the founder asks (every push deploys prod).
- Single-line conventional commits; no process labels; version bumps =
  `chore: version packages`.
- Always create changesets for changed packages; release via `bun run release`.
- Prefer delete over refactor when removing deprecated surfaces.

### Voice (user-facing copy)

- Calm infrastructure. Short declarative sentences.
- No exclamation points, no emoji, no hype, no "vs Hiro" — generous to the ecosystem.
- Technical precision over marketing language.

### Decision rules

- Reversible: decide, note it in the commit, move on.
- Irreversible (cursor format, public API shape, pricing, product naming):
  explicit founder approval first.

---

*If you change anything that contradicts this file or STRATEGY.md, update the
doc in the same change. Stale instructions are worse than none.*
