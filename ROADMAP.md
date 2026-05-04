# Roadmap

Twelve weeks of execution, then a six-month outlook. Phases are sequential. Each phase has a single headline outcome and a decision gate at the end. If a gate fails, the next phase is rescoped or deferred — we don't run phases in parallel just because the calendar says so.

This document complements `VISION.md` (where we're going), `ARCHITECTURE.md` (how it's built), and `PRODUCTS.md` (what we sell). Sprint docs in `.claude/sprints/` are the weekly-grain source of truth.

---

## Calendar

| Phase | Weeks | Headline outcome |
|---|---|---|
| Phase 1 — Reliability + Surfaces | 1–3 | Streams + Index live, status page public, single-server recovery ready |
| Phase 2 — Datasets + Console | 4–6 | Five Foundation Datasets shipped, Console v1 live |
| Phase 3 — Foundation + Hiro motion | 7–9 | Grant submitted, architecture article published, Hiro one-pager delivered |
| Phase 4 — Partner Platform | months 4–6 | Multi-tenant platform demo-ready for Hiro |

---

## Phase 1 — Reliability and surfaces (weeks 1–3)

The engine is 90% built. Phase 1 is about exposing what already exists and shoring up the operational story so partners and paying customers can trust it.

**Deliverables**
- Public status page covering current live node/service health, ingest lag, L2 decode lag, API p50/p95, and error rate.
- Stacks Streams API: cursor-paginated read endpoint over L1 events. Auth, rate limit, metering.
- Stacks Index API: REST endpoints over decoded events. Auth, rate limit, metering.
- Documentation site updated with Streams + Index reference, quickstarts, and migration notes from Subgraphs-only.
- Pricing page updated to reflect Build / Scale / Enterprise with the locked numbers.
- Current live server inventory, operator recovery runbook, backup verification, deploy rollback path, and one non-destructive recovery drill.

**Out of scope this phase**
- Console UI (that's Phase 2).
- Datasets (Phase 2).
- Webhook delivery from raw events (not on roadmap).
- Hot-spare failover automation and rehearsal. This requires funded second-node infrastructure.

**Decision gate (end of week 3)**
- Are Streams and Index live, observable, metered, documented, recoverable, and behind paid auth? If no, extend Phase 1 by one week before starting Phase 2. Do not start Phase 2 with broken or missing surfaces.

**Gate status, May 4, 2026:** Implementation is complete locally, but Phase 1 is not green until the final reliability patch is deployed and verified. The open production evidence is: `/public/status.services[]` must report `indexer: ok`, two consecutive Staging Health runs must pass after deploy, and daily `pg_dump` plus WAL sync freshness must be recorded.

---

## Phase 2 — Foundation Datasets, Console, Streams bulk dumps (weeks 4–6)

Public artifact, self-serve, and the parquet pipeline that powers both.

**Deliverables**
- Five datasets, each with a stable read API, parquet downloads, schema docs, and a small dashboard:
  1. STX transfers
  2. PoX-4 / Stacking
  3. sBTC
  4. BNS
  5. Network health (block times, mempool, fees, reorgs)
- Datasets dashboard: a single-page UI with charts and links into the API.
- **Streams bulk dumps:** parquet files on S3 partitioned by block-height range, with manifest. Same pipeline as Datasets — ship once, two products consume it.
- Console v1: API key management, usage metrics, billing, subgraph list, subscription list.
- Self-serve checkout for Build and Scale (Stripe).
- 30-day trial flow live.

**Out of scope**
- Partner Platform features.
- Custom dataset requests.
- Subgraph templates shelf (defer to Phase 3 if Phase 2 runs hot; otherwise opportunistic).
- SOC2 work.

**Decision gate (end of week 6)**
- Datasets shipped and indexed by search? Streams parquet dumps live with manifest? Console handling self-serve checkout end-to-end? If yes, proceed to Phase 3. If Console is partial, ship what's done and continue Console work in the background through Phase 3.

---

## Phase 3 — Foundation grant and Hiro motion (weeks 7–9)

Convert the public artifacts and infrastructure story into ecosystem support and a partner conversation.

**Deliverables**
- Stacks Foundation grant proposal submitted. Ask: $150–300K to fund Datasets shelf operation and expansion (NFT marketplaces, DeFi, mining stats) for 12 months. Proposal frames Datasets as public goods.
- Architecture article published (long-form, on the company blog and cross-posted to paragraph). Audience: Stacks developers, Hiro, Foundation. Tone: technical, calm, generous.
- Hiro one-pager delivered. Format: 1-page PDF + 15-minute call. Pitch: Second Layer as the data plane underneath Hiro Platform; Partner Platform preview; commercial structure (rev share or wholesale).
- Two reference customers on Build or Scale, named publicly with their consent.

**Out of scope**
- Partner Platform implementation (Phase 4).
- Aggressive competitive marketing.

**Decision gates (end of week 9)**
- **Grant:** Submitted? Foundation in dialogue? If submitted and dialogue is open, proceed. If declined or non-responsive after two weeks, revisit Datasets funding model in Phase 4 planning.
- **Hiro:** One-pager delivered and call held? If response is positive, Phase 4 is Partner Platform. If response is negative or silent, Phase 4 pivots to direct competition (different roadmap; reopen this doc).

---

## Phase 4 — Partner Platform (months 4–6)

Conditional on Phase 3 outcome. Assuming Hiro motion is positive:

**Deliverables**
- Multi-tenant management plane: nested tenancy, Admin API, aggregate dashboards.
- Subgraph and dataset templates partners can clone and brand.
- Contract-grade SLA tier with dedicated read replicas.
- Billing aggregation: partner sees one invoice, individual customers metered underneath.
- Hiro pilot: at least one workload running on Partner Platform, behind a Hiro-branded surface.

**Out of scope**
- Marketplace v2 (third-party templates with rev share).
- Multi-chain.

**Decision gate (end of month 6)**
- Hiro pilot live with real workload? If yes, Partner Platform becomes a named product line and we plan Phase 5 (general availability + a second partner). If no, hold Partner Platform in private beta and lean back on direct app-developer growth.

---

## Infrastructure trajectory

Cost grows in step with phases. Numbers are monthly run-rate.

| Stage | Approx cost | Drivers |
|---|---|---|
| Today | $300–400 | Current live server and supporting services |
| End of Phase 1 | ~$400–700 | Status page telemetry, smoke checks, backup verification, storage growth |
| End of Phase 2 | ~$1,500 | Datasets pipelines, Console hosting, Stripe |
| End of Phase 3 | ~$2,500 | Reference customer load, marketing CDN, more storage tiers |
| End of Phase 4 | ~$4,000–5,500 | Partner Platform tenancy, dedicated replicas, SLA headroom |

Cost discipline: every new line item is justified against either a paying customer cohort or the Foundation grant. No speculative provisioning.

## Deferred reliability milestone

Hot-spare infrastructure is deferred until there is budget for a second node/server. The future milestone should include funded spare capacity, operator-confirmed failover, rollback, alerting, and at least two rehearsals with recovery-time evidence. Automatic promotion is not part of the v0 failover model.

---

## Risks and how we handle them

- **Hiro launches a competing managed subgraph product.** Mitigation: ship Partner Platform first; lead with "we run this for you" rather than "we beat you." If they ship anyway, our wedge is L1 + L2 surfaces and Datasets, not Subgraphs.
- **Foundation grant doesn't land.** Mitigation: Datasets are still useful as marketing and TAM expansion. Trim dataset cadence; keep core five running.
- **Stacks ecosystem stays small.** Mitigation: Partner Platform is leverage — one Hiro deal is worth dozens of direct customers.
- **Solo-founder bandwidth.** Mitigation: ruthless scope discipline at decision gates. Defer rather than half-ship.
- **Reorg / data correctness incident.** Mitigation: status page, public post-mortems, replay tooling. Reputation is the moat.

---

## Working agreements

- One phase at a time. No parallel phases without explicit decision.
- Decision gates are real. If the gate fails, the next phase is rescoped before any work starts.
- PRDs in `docs/prds/` are written 1–2 weeks before work begins on a deliverable. Sprint docs in `.claude/sprints/` are weekly and tight.
- This file gets updated at every gate. The four root docs (`VISION.md`, `ARCHITECTURE.md`, `PRODUCTS.md`, `ROADMAP.md`) are the durable agent context — they are read every session.

---

*Last reviewed: May 2026. Next review: end of Phase 1.*
