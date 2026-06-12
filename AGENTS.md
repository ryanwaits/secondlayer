# AGENTS.md

Operating instructions for AI coding agents working in this repo. Read this and
`STRATEGY.md` first, every session.

---

## Repo orientation

Secondlayer is the hosted indexer for Stacks. Three products — **Index** (decoded
chain data over REST, keyless), **Subgraphs** (your schema on our indexer), and
**Streams** (raw signed firehose + dumps for build-your-own-indexer devs) — plus
features (Subscriptions, Explore, Contract discovery, Verification) and channels
(REST/OpenAPI, CLI, SDK, MCP). `STRATEGY.md` is the source of truth for product
taxonomy, pricing, and what's frozen.

```
secondlayer/
├── STRATEGY.md        ← what we build and why (wins all contradictions)
├── AGENTS.md          ← this file
├── docs/              ← audits, specs, guides, sprints (historical)
├── packages/
│   ├── indexer/       ← block follower, decoders; writes raw + decoded planes
│   ├── api/           ← public HTTPS surface (/v1: index, subgraphs, streams, x402)
│   ├── subgraphs/     ← subgraph compiler + runtime
│   ├── platform/      ← accounts, plans, billing
│   ├── worker/        ← crons (reconcile, sweeps, alerts)
│   ├── mcp/ sdk/ cli/ ← clients (golden-path surface only — see parity firewall)
│   ├── stacks/        ← chain primitives SDK (/clarity is load-bearing; wallet half frozen)
│   └── shared/        ← db, schemas, vocab single-sourcing
└── apps/web/          ← www marketing + docs + /platform console
```

---

## Working agreements

### Parity firewall (load-bearing)

A new capability ships as a **REST route + OpenAPI entry only**. SDK/CLI/MCP
wrappers are added on first external request — generated where possible, never
speculatively hand-mirrored. Releases batch weekly via changesets.

### Frozen periphery

BYO database plane, multi-ORM codegen, aggregates, index proofs/stacking/mempool
extras, CLI devnet/local/db, the stacks-SDK wallet half, subscriptions format
expansion. Shipped code stays; no new investment, no docs prominence. Delete on
first maintenance touch. Unfreeze requires a named external request.

### Scope discipline

- Reads are open in beta: keyless on `/v1`, keys gate writes. Don't add read auth.
- Cursor format and public `/v1` envelope are 1.0 contracts; reorg/cursor tests
  are sacred.
- The decoder service (`packages/indexer` l2 module) reads from Streams in production — dogfooding, do not break it.
- Never describe product surfaces as L1/L2/L3 layers in docs or comms — Stacks is itself a Bitcoin L2, so the terms confuse users. Say raw (Streams), decoded (Index), your schema (Subgraphs). Internal code identifiers (`l2-decoder`, `l2_*`) stay as-is.
- No EVM/multi-chain. No wallet-side primitives beyond what's already frozen.

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
