# Kickoff — Data-plane wedge execution

> Paste the block below into a fresh session to begin scoping/building the data-plane
> roadmap items. Self-contained; assumes the repo + auto-memory only.

---

We're starting execution on the **data-plane / anchor wedge** — the work scoped in the last few sessions. Before doing anything, load the ground truth, then we'll scope ONE item at a time into an atomic plan and build.

## Mission (one sentence)

Become the **decoded-semantics data plane** for the Stacks ecosystem's big players — be the maintained successor to Hiro's archived Chainhook, leading with the data Hiro *declined* to build (decoded sBTC peg events, PoX-cycle semantics, decoded Clarity calls) — and convert that into anchor deals (Zest, Dune, wallets) + a self-serve tier toward $30k MRR over 24–36mo.

## Read first (don't re-derive — it's all written down)

1. `STRATEGY.md` — the three products + operating rules (parity firewall, demand-before-supply, frozen periphery).
2. `docs/ROADMAP.md` → the **"Data-plane / anchor wedge"** section — the prioritized BUILD/ENHANCE items with file pointers, the **"Anchor / GTM framing"** block (Stacks Labs Track A/B), and **P1** (the webhook-signing fix). This is the backlog we're executing.
3. `docs/internal/audits/data-plane-wedge-2026-06-13.md` — the full gaps/done-right/MRR analysis + the adversarial critique (read the critique; it's the honest counterweight).
4. `docs/internal/audits/multichain-ordinals-l1-expansion-2026-06-12.md` — why we DON'T add chains / don't drift into general Bitcoin indexing.
5. Auto-memory `project_data_plane_wedge` + `project_multichain_expansion_research` load automatically — they hold the founder rulings.

## Sequencing (execute in this order — it respects the 2-person throughput ceiling)

1. **NOW (S):** Webhook ed25519 silent-no-op fix (P1). Real prod integrity bug — "signed" webhooks ship unsigned. Trust prerequisite for every anchor. **Start here.**
2. **(M):** Productize decoded sBTC peg-in/peg-out SKU (typed endpoints + webhook topics + lifecycle state machine + finality gating). Substrate is ~80% already decoded — packaging, not ingestion. Pairs with the **BTC L1 settlement confirmer** (withdrawals only, against our own bitcoind).
3. **(M):** PoX-cycle / reward-set aggregate endpoints.
4. **(the real quarter — scope as 3–4 builds):** SLA-enabling redundancy (hot-spare node + Postgres replica + leader-failover + status page/runbook) AND the **correctness** cross-check (Emily reconciliation → hold-publish on divergence; canonical-hash canary). Gates the two biggest MRR lines.
5. **(M):** Flip $299 Studio public + Phase-1 capacity caps.
6. **(L):** Account/address read surface (balances/nonces/holdings) — the wallet wedge.
7. **(on named pull only):** Dune/QuickNode wholesale tableset, tenancy plane, read-only Clarity call proxy.

After the peg SKU ships, build the **reference-implementation shelf** (flagship = sBTC Peg Explorer) as the proof artifacts.

## Guardrails (non-negotiable — these came from founder rulings)

- **Honesty:** claim "decoded sBTC/PoX/Clarity data Hiro declined" (true, shippable). **Never** claim "run the Hiro API without a node" — false until balances + call-read ship.
- **BTC L1:** surface Bitcoin data ONLY for sBTC peg settlement. Do NOT drift into general BTC balances/UTXO/ordinals indexing (different engine, saturated, Xverse incumbent).
- **Zest primitive:** build the liquidation/health-factor trigger as a PORTABLE "collateral-breach" template (Granite/Velar reuse), not Zest-only.
- **MRR model:** anchors = recurring MRR; Foundation/Labs grants = one-time runway, NOT MRR. Don't model Stacks Labs as recurring until they wire our feed into something they ship.
- **Correctness vs availability:** the SLA-redundancy item is *availability*; the Emily/canary item is *correctness*. Keep them distinct.

## How we work this session

- **Pick ONE item (start with the webhook fix), then enter plan mode** and produce a concise atomic plan: sprints → committable tasks → explicit validation per task. Spawn a subagent to review the plan before ExitPlanMode (per global CLAUDE.md).
- **Bug-first discipline:** the webhook fix is a bug — write a tmp test reproducing "signer returns null / delivery unsigned" before fixing.
- Work directly off `main` (no feature branch); single-line conventional commits, no process labels; create changesets for changed packages; **don't commit or push until I say.** `docs/ROADMAP.md` already has uncommitted edits in the tree — leave them.
- Internal docs go to `docs/internal/` (gitignored). Only `docs/ROADMAP.md` + `docs/incidents/INCIDENTS.md` are tracked.
- Run the QA gate (`/check`) on touched files before declaring anything done.

**First action:** read the 5 docs above, give me a 3-bullet confirmation of the plan + the do-first item, then we scope the webhook-signing fix.

---

*(Saved from the 2026-06-13 data-plane scoping sessions. ROADMAP edits are uncommitted pending founder go.)*
