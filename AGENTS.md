# AGENTS.md

Operating instructions for AI coding agents (Claude Code, Codex, Cursor, others) working in this repo.

Read this first, every session. It tells you where to find context, how to plan, and what the rules are.

---

## Repo orientation

Second Layer is the data plane for Stacks. Layered primitives — raw events (L1), decoded transactions (L2), user-defined subgraphs (L3) — exposed through a small set of products.

```
secondlayer/
├── VISION.md          ← why we exist (durable)
├── ARCHITECTURE.md    ← how the system is built (durable)
├── PRODUCTS.md        ← what we sell (durable)
├── ROADMAP.md         ← 12-week plan and decision gates (durable)
├── AGENTS.md          ← this file
├── docs/
│   ├── prds/          ← per-deliverable specs (NNNN-name.md)
│   └── specs/         ← technical reference (schemas, protocols)
├── .claude/
│   └── sprints/
│       ├── current-sprint.md   ← active week, single source of truth for tactical work
│       └── archive/            ← completed sprints
├── packages/
│   ├── indexer/       ← block follower, decoder; writes L1 + L2
│   ├── api/           ← public HTTPS surface (Streams, Index, Subscriptions)
│   ├── subgraphs/     ← subgraph compiler, runtime, per-tenant Postgres
│   ├── mcp/           ← MCP server
│   ├── stacks/        ← Stacks-specific primitives (open source)
│   ├── sdk/           ← customer-facing TS/JS SDK (open source)
│   └── cli/           ← `secondlayer` CLI (open source)
└── apps/
    └── console/       ← web dashboard (Phase 2)
```

---

## Read order at the start of every session

Always read in this order. Do not skip.

1. **`AGENTS.md`** — this file.
2. **`VISION.md`** — what we're building and why.
3. **`ARCHITECTURE.md`** — the layered model. The component you're touching maps to a layer.
4. **`PRODUCTS.md`** — the product whose surface you're changing. Naming rules live here.
5. **`ROADMAP.md`** — current phase and decision gates.
6. **`.claude/sprints/current-sprint.md`** — what work is actually in flight this week.
7. **The relevant PRD in `docs/prds/`** — the contract for the deliverable.

If you can't find a PRD for the work you're being asked to do, **stop and ask** before writing code. We don't ship surfaces without a PRD.

---

## How we plan

Three horizons, three doc types. Each feeds the next.

| Horizon | Doc | Purpose | Cadence |
|---|---|---|---|
| Strategic (months) | `VISION.md`, `ROADMAP.md` | Why and when | Reviewed at phase gates |
| Product (weeks) | `docs/prds/NNNN-*.md` | What and how | Written 1–2 weeks before work begins |
| Tactical (days) | `.claude/sprints/current-sprint.md` | Today's tasks | One week, then archived |

**The flow:**

```
ROADMAP.md identifies a deliverable for the next phase
   ↓
PRD is written 1–2 weeks before sprint work begins
   ↓
Sprint doc cites the PRD and lists ordered tasks for the week
   ↓
Work happens; daily log updated; end-of-week checklist run
   ↓
Sprint archived; next week's sprint written
```

**One active sprint at a time.** Never pre-write multiple sprint docs. The next sprint is written on the Sunday it begins, after archiving the previous one.

**If a PRD changes mid-sprint:** stop coding, update the PRD, then resume. Don't let sprint scope drift quietly.

---

## Working agreements

### Naming (this is product-load-bearing)

- Every product is `Stacks <X>` except MCP Server.
- **Never use:** "Stacks API" (ambiguous), "Indexer" as a product name (it's an internal component), "Chainhook" prefix for our raw events (different lane), "Streaming" for Subscriptions, "Stream API."
- The product is **Stacks Streams**. Singular concept, plural noun.

### Scope discipline

- L1 (Streams) is **read-only**. No push, no webhooks, no filter DSL beyond `event_type` and `contract_id`. Push lives in Subscriptions over L2/L3.
- We do not deliver webhooks from raw chain events. That is Hiro Chainhooks' lane.
- We do not build wallet-side primitives. We do not do EVM or multi-chain. We do not run a subgraph marketplace with rev share.
- If a task feels like it's pulling toward any of the above, you've drifted. Stop and re-read `PRODUCTS.md` § "What we don't sell."

### Voice

When you write user-facing copy (docs, error messages, blog posts):

- Calm infrastructure. Short declarative sentences.
- No exclamation points. No emojis unless the user asks. No hype.
- No "vs Hiro." We are generous to the ecosystem.
- Technical precision over marketing language.

### Code

- TypeScript / Rust where each is already used. Don't rewrite across boundaries casually.
- The indexer is the source of truth for L1 and L2. Surfaces in `packages/api` are thin reads on top.
- The L2 decoder reads from Streams in production — this is dogfooding, do not break it.
- Tests for cursor and reorg correctness are sacred. Touch them only with intention; cursor format is a 1.0 contract.

### Decision rules

- **Reversible decisions:** make them, document briefly in the PRD, move on.
- **Irreversible decisions** (cursor format, public API shape, pricing, product naming): require explicit approval before changing. Do not change in the middle of a sprint.

---

## When you're stuck

In order:

1. Re-read the PRD for the work.
2. Re-read the relevant section of `ARCHITECTURE.md` or `PRODUCTS.md`.
3. Check `.claude/sprints/archive/` — the same problem may have surfaced before.
4. Ask the user. Don't guess on irreversible decisions.

---

## Daily rituals (if you're an agent driving multiple sessions in a day)

- At session start: read the read-order list above, then the daily log in `current-sprint.md`.
- At session end: append one or two bullets to today's daily log entry. Be specific — "wired auth middleware, 429s working at 11 req/s on Free, Build pass-through verified" beats "worked on auth."
- If a task slips by more than a day: stop, surface it to the user, and re-plan rather than silently extending.

---

## End-of-week ritual (Sunday)

Run by the user, but agents should know what it is so they can prep for it.

1. Mark the end-of-week checklist in `current-sprint.md`.
2. Update progress notes in `ROADMAP.md` for the current phase.
3. If a phase decision gate is reached, run the gate explicitly — proceed, extend, or pivot. Document the decision.
4. Archive the current sprint to `.claude/sprints/archive/YYYY-MM-DD.md` (Monday's date).
5. Write the next `current-sprint.md`, citing the relevant PRD.
6. If the next phase is approaching, confirm the next PRD is drafted.

---

## What's currently in flight

This section is updated weekly. Keep it short — link out for detail.

- **Phase:** 1 (Reliability + Surfaces), week 1 of 3.
- **Active PRD:** `docs/prds/0004-phase-1-api-sdk-dx-completion.md`.
- **Active sprint:** `.claude/sprints/current-sprint.md` (May 4–10).
- **Next focus:** Additive API, SDK, and DX completion across Stacks Streams, Stacks Index, and Stacks Subgraphs.
- **Decision gate ahead:** end of Phase 1 — Streams + Index live, metered, behind paid auth.

---

*If you change anything that contradicts this file, update this file in the same change. AGENTS.md is the agent's home page; stale instructions here are worse than no instructions.*
