# PRICING MODEL AUDIT — Are we an indexer pricing like an RPC gateway? (2026-06-12)

## 1. Verdict

**Partially yes — and we already knew.** The live ladder (Free / Pro $99 / Enterprise custom; a `scale` plan id exists in code at $299 for manual deals only, per STRATEGY.md — it is NOT a public tier) headlines req/s, which is the Alchemy/QuickNode RPC convention applied to a business whose marginal request cost is ~$0 (two fixed Hetzner boxes, free R2 egress, ~99% margin per `docs/pricing-scalability-analysis.md`). Our real costs — per-tenant subgraph materialization + storage, backfill compute storms, concurrent SSE connections pinning Postgres, sponsor gas — are either binary feature gates, counted-but-unbilled, or completely unlimited.

Three honesty caveats before the indictment:

1. **It was a conscious simplification, not cargo-culting.** The focus audit (§5) deliberately shrank the offer to "sell only what code enforces"; the roadmap ruled "no metered billing until ≥10 paying accounts." The req/s surface is interim scaffolding.
2. **The repo contains its own diagnosis.** `pricing-scalability-analysis.md` (2026-06-07) already concluded "SSE connection count, not request rate, is the real capacity constraint" and called a per-tier SSE cap "the single most important pricing lever." It was never built. Neither was any storage lever on Subgraphs. Both were flagged as ~$0 to implement.
3. **The local market (Hiro, Maestro) also prices on rate+volume** — we're not uniquely wrong for Stacks. But we're missing even *their* second axis (monthly request volume), and the managed-indexer specialists (Goldsky, Envio, OnFinality, Ghost) price on something else entirely.

The sharpest framing: **Goldsky meters exactly what we give away (sync worker-hours, entities stored, rows delivered) and gives away exactly what we meter (reads, within rate limits).** They apply per-request pricing only to their actual RPC product. We applied it to everything.

**Scope limit:** this audit answers the cost/meter half of the founder's question. It does NOT model revenue (Phase 1+2 vs the $8–10k MRR self-serve target), segment customers (x402 agents vs dapp devs vs analysts), or reason about willingness-to-pay — the value-side half is unanswered here. It also never pulls actual prod usage (subgraphs per account, rows per tenant schema, peak SSE tails, delivery volumes) — all queryable today and a Phase 1 prerequisite.

## 2. Current model laid bare

What we meter vs what costs us vs what users value, per product:

| Product | We charge on | Actual cost driver | What users value |
|---|---|---|---|
| **Index** | req/s (100/250/500), x402 $0.001/call | ~nothing marginal — shared decoded tables, written once by one l2-decoder for all tenants; cost scales with chain growth, not users | decoded data keyless in 10s; depth/history (free, unbounded, at every tier) |
| **Streams** | req/s (10/250/500) + retention days (7/30/90) | concurrent SSE connections — each tail pins 1 PG connection for its whole session + re-runs a 3-table join every 1.5s; max_connections=200 is the first system-wide wall; deep history is the CHEAPEST thing we serve (immutable parquet, $0 R2 egress) | live tail + bulk dumps |
| **Subgraphs** | private gate, genesis-backfill gate (binary, Pro) | **the only true per-tenant marginal cost in the company**: dedicated PG schema per deploy, 24/7 processor, genesis backfill = CPU storm, standing GB forever | hosted tables + public API, zero infra |
| **Subscriptions** | subscription COUNT (3/25/∞) | deliveries = events × subs × (1+retries), superlinear; **NOT counted** — `usage_daily.deliveries` column exists (migration 0004) and getUsage reads it, but zero increment callsites repo-wide; deliveries exist only as `subscription_deliveries` rows (emitter.ts). Also two cost profiles priced as one bucket: subgraph subs vs direct chain subs (no per-tenant schema) | reliable webhooks |
| **x402** | flat per-call, gas-indexed floor | sponsor STX gas per settled call — **the one price in the system actually derived from marginal cost** (`x402/catalog.ts`) | accountless access |
| **Datasets** | nothing | ~nothing — curated manifests over the same dumps/R2 | curated starting points; explicit stance: free funnel, folds into the dumps-stay-free position (roadmap: Datasets→Catalog) |

The inversions, plainly:

- **Streams pricing is upside-down.** Retention gates the live API while the same history is free via public parquet. The expensive thing (live tip + SSE) has no concurrency or duration cap at any tier; the cheap thing (history) is the gate. Caveat: Streams reads are key-mandatory (keyless = 402 now that x402 is live), so the exposure is Free-KEYED tails, not anon — account-attributable, which makes a per-tier cap enforceable. A Free-keyed user holding a multi-hour SSE tail costs more than a Pro user doing 250 rps of keyset reads.
- **Subgraphs — the declared monetizable core — has the thinnest monetization.** Two binary gates. No limit on subgraph count, rows, storage GB, or handler compute. A free account can run unlimited public forward-only subgraphs consuming processor + disk 24/7 for $0. Goldsky would charge ~$36.50/mo per always-on subgraph + ~$4/100k entities for the same thing.
- **We meter some things we never bill.** `usage_daily` counts Index/Streams rows-returned (counters emit: routes/index.ts:171, routes/streams.ts:134); documented overage prices ($4/100K index rows, $1/100K webhook events) exist in docs — no Stripe meter. But webhook deliveries are NOT counted at all (dead column, zero increments) — flipping that meter needs counter wiring + emit, not just a Stripe meter.
- **Tier-vocabulary drift:** rate-tier configs say free/build/scale ≠ plan ids none/launch/scale/enterprise ≠ public ladder Free/Pro/Enterprise. (Corrected: there is no $499 anywhere — that was the superseded June-9 roadmap proposal; STRATEGY.md's Free/Pro $99/Enterprise is canon, with `scale` $299 as a code-only manual-deal vehicle.)
- **Free keyed ≈ free anon on Index, but not identical:** anon = one SHARED global 100 rps bucket across all anon callers (`INDEX_ANON_RATE_LIMIT_PER_SECOND`); keyed free = 100 rps PER TENANT. Keying up buys a private bucket — still a thin reason to create an account.
- **x402 vs free-tier arbitrage unpriced:** why would an agent pay $0.001/call when keyless Index reads are free at the shared-bucket rate on the same routes? And Pro at $99 undercuts x402 above ~99k calls/mo. The two rails' coherence is unanalyzed.

## 3. The market map

| Vendor | Primary meter(s) | Free tier | Model family |
|---|---|---|---|
| **Alchemy** | Compute Units per call, cost-weighted (eth_call 26 CU → portfolio 1000 CU); req/s = gate only | 30M CU/mo, 25 rps | usage credits |
| **QuickNode** | API credits (shared pool); Streams = credits per BLOCK processed; backfill = blocks × multiplier, one-time billable | 10M credits, 15 rps | usage credits |
| **The Graph** | $2/100k queries — only user-facing meter; indexing subsidized 40:1 by token inflation; migrating to per-block-indexed + per-entity-stored rent (GIP-0081) | 100k queries/mo, ∞ subgraphs | per-query (token-subsidized) |
| **Goldsky** | subgraph worker-hours ($0.05/hr ≈ $36.50/mo/active subgraph) + entities stored (~$4/100k-mo) + events written to sink ($1/100k); reads FREE within rate limit | 3 subgraphs, 100k entities, pause-on-limit | resource-based |
| **Envio** | indexing-hours + stored events; HyperSync (raw) = per-request. **UNVERIFIED numbers:** "800 incl, $0.10–0.50/extra hr, 1M/10M/100M stored events" came from a live JS bundle and could not be re-verified server-side; only the indexing-hour unit (~730 hrs = 1 deployment-month) and free dev tier confirmed | free dev tier w/ age/usage-based auto-delete hygiene | resource-based (managed) + per-request (raw) |
| **SQD Cloud** | compute-hours per squid component + $0.60/GB-mo storage | 1 playground squid | resource-based |
| **OnFinality/SubQuery** | $0.08/deploy-hr per project + $0.07/hr extra vCPU + entities stored | dev-only free | resource-based |
| **Ghost** | graphs count (2/10/30) + monthly query volume + entities stored ($25–50/1M overage) | 2 graphs, 300k entities | per-entity + query volume |
| **Dune** | credits (CPU-sec + scan + export per-MB); storage caps per tier | 2,500 credits | usage credits (analytics) |
| **Allium / Coin Metrics** | flat enterprise subscription per datashare/freshness tier, customer brings compute, no query metering | community/keyless subset | enterprise-flat |
| **Hiro** | RPM + monthly request volume (900 RPM + 150K req/mo free → $99 = 3K RPM + 15M req/mo) | rate-generous, volume-stingy | rate-tier SaaS |
| **Maestro** | endpoint-weighted compute credits + req/s + webhook/project counts; published overage $2–2.5/100k; ships x402 | 1M credits, 10 rps | usage credits |
| **Algolia** (non-crypto analogue) | records STORED in index ($0.40/1k/mo) + searches ($0.50/1k) | 1M records | per-entity-stored + reads |
| **Fivetran** | rows changed/synced (MAR); historical backfill FREE as acquisition | 500k MAR | work-done flow meter |

Pattern: **nobody whose core business is indexing uses req/s as the primary meter.** Per-request belongs to RPC (Alchemy, QuickNode, Goldsky Edge, Envio HyperRPC). Managed indexing prices on sync compute + entities stored. Bulk data prices on egress/credits or enterprise-flat. Rate limits everywhere exist as abuse guards and tier gates, never the headline.

**Coverage gaps (vendors not surveyed, closest analogs to our products):** StreamingFast/Substreams/Pinax — the canonical firehose pricing precedent, nearest analog to Streams; Svix/Hookdeck — webhooks-as-a-service per-message pricing, nearest analog to Subscriptions (which above rests on a single Goldsky sink data point); Helius — the modern indexer-flavored API company with priced webhooks + enhanced APIs, a better Index comp than Moralis; Bitcoin-side: Blockchair (credit pricing), BestinSlot/Unisat (Ordinals indexers — closest "indexer on Bitcoin" pricing in the wild). Stacks coverage (Hiro, Maestro, mempool.space) is otherwise complete — the Stacks market really is just those API vendors.

**Self-host as pricing ceiling (unaddressed above):** Chainhook + stacks-blockchain-api are open-source, and Ponder/SubQuery/graph-node self-host fine — a capable Stacks team's alternative price is $0 + a VPS. That bounds willingness-to-pay for every cap/overage proposed below.

Two cautionary tales: **Alchemy killed its Subgraphs product (Dec 2025)** even with usage pricing — hosted subgraphs inside an RPC-margin business died; the survivor (Goldsky) wins on storage pricing. **Tinybird and PlanetScale both retreated** from fine-grained usage meters to fixed capacity tiers in 2025 — adversarial optimization + bill shock. Predictability beats purity.

## 4. Model families per OUR product — they differ, and that's the insight

**Index → rate-tier SaaS is actually fine here.** Shared-cost, read-heavy, ~zero marginal cost per request. This is the Moralis/thirdweb/Hiro-shaped half of the product, and req/s + a monthly volume number is the honest market pattern. Our mistake isn't the meter — it's anon-vs-keyed near-parity and no monthly volume axis at all. Hiro pairs every RPM with a req/mo cap; we'd give away ~260M req/mo theoretical on $0 — though note the ~260M exposure is mostly the ANON lane, which per-account volume caps can't touch (open beta = no read auth; see Q7).

**Subgraphs → resource/entity pricing, unambiguously.** It is the only product with true per-tenant marginal cost (schema + processor + storage), and every dedicated indexing vendor on earth prices it on slots + entities/storage + sync compute. Pricing it with req/s is the category error the founder's question is sniffing at. The proven units: active-subgraph slots (Goldsky ~$36.50/mo emergent, Ghost 2/10/30 caps), entities/rows stored — at entry rates Goldsky ~$39/M-mo ($0.0053/hourly-unit per 100k, 100k–10M tier ≈ $3.87/100k-mo, matching §3; $10/M only at the 10M+ volume tier), Ghost $25–50/M overage, Alchemy $25/M (defunct product — historical anchor only, see appendix) — i.e. entry-level entity pricing runs HIGHER than a naive descending ladder suggests, which strengthens the resource-pricing case; backfill as metered or one-time compute (QuickNode blocks × multiplier, OnFinality paid vCPU knob). Even The Graph — the query-only purist — is retrofitting per-block-indexed fees + entity storage rent because query fees funded ~$400k/yr network-wide.

Two holes in this story as written: (a) **BYO-database subgraphs are shipped product today** (typed `ByoBreakingChangeError` path, prod-live), not just a future Enterprise SKU — their rows live in the customer's Postgres, uncountable from our side, so any stored-rows cap needs an explicit BYO carve-out and BYO weakens the per-tenant marginal-cost premise for those deploys. (b) **Public-subgraph read cost under open beta is attributed to nobody** — deployer holds the slot, readers are anon; The Graph's whole model answers this (readers pay per query) and we don't ask it (see open questions).

**Streams → split it.** The live firehose's cost is connections, so the lever is per-tier concurrent-SSE caps (Bitquery sells concurrent streams + stream-minutes; nobody meters firehose per-request). The bulk dumps cost ~nothing to serve ($0 R2 egress — a structural advantage vs requester-pays S3) and the entire raw-data market gives raw away as funnel (AWS/BigQuery free parquet, Dune free tier, Flipside died trying to sell it). Dumps should stay free as acquisition; the monetizable axis, if ever, is enterprise-flat datashare/freshness contracts (Allium shape) — talk-to-sales, not self-serve.

**Subscriptions → per-delivery, not per-subscription.** Cost is deliveries (superlinear); Goldsky meters rows written to sink ($1/100k), we already documented $1/100k and count it. Count quotas (25) are a poor proxy — one firehose sub outcosts 25 quiet ones.

**x402 → keep as-is.** Gas-indexed floor is the one cost-derived price we have; prepaid fail-closed mirrors SubQuery flex plans; Maestro shipping x402 validates the niche. It's structurally a CU model already — per-route weights would complete it, but it's a payments wedge, not a billing meter.

## 5. Options we haven't considered

Concrete, ranked by evidence strength:

1. **Per-tier SSE/stream concurrency caps** (e.g. Free 2, Pro 10, Enterprise custom). Our own analysis calls it the single most important lever; caps the one resource that takes prod down. Not even a billing change — a capacity gate that makes Pro mean something real. Build cost is DAYS, not ~$0: no connection tracking exists in the SSE path or rate-limit store today. Feasible — Redis is deployed and already backs the rate-limit store (solves the 2-replica counting problem) — but needs connect/disconnect lifecycle, stale-counter GC (replica crash leaks counters → false lockout), and a policy for x402 accountless tails (no tenant key).
2. **Subgraph slots per tier** (e.g. Free 3 active, Pro 10, Enterprise custom). Ghost-style counts, Goldsky-style "I need a 4th always-on subgraph" upgrade moment. Today: unlimited at every tier including $0.
3. **Entities/rows-stored allowance + overage** (e.g. Pro includes 5M rows across subgraphs, then $X/1M-mo; BYO deploys carved out — rows on customer Postgres are uncountable). The industry-proven indexing meter (Goldsky ~$39/M-mo entry / $10/M at 10M+ volume; Ghost $25–50/M overage; OnFinality ladders; defunct-Alchemy $25/M as historical anchor). Stock-like, predictable, user-visible — the meter family Tinybird/PlanetScale retreats say is safe.
4. **Backfill as paid compute** — genesis/full-history as a one-time priced job (blocks × rate, QuickNode-style) or an Enterprise/manual-deal entitlement with N included. Today our most expensive single operation is a Pro checkbox capturing $0 marginal revenue.
5. **Flip on the overage meters** (index rows returned $4/100K — counter exists and emits, only Stripe meter missing; webhook deliveries $1/100K — counter does NOT exist, `usage_daily.deliveries` is never written, so this one needs counter wiring + emit too) once ≥10 paying accounts exist per roadmap ruling.
6. **Monthly request volume as the second Index axis** (soft cap, Hiro-style) so paid tiers sell volume headroom, not just instantaneous rate. Enforcement gap: per founder ruling open beta = no read auth, so per-account volume caps bind keyed traffic only — the anon shared bucket stays volume-unbounded.
7. **Free-tier subgraph hygiene: auto-recycle deployments, Envio-style — but copy the actual mechanism: AGE/usage-based, not idle-based.** Envio's Development plan: 30-day max deployment lifespan + soft limits (100k events processed / 5GB storage) → 7-day notification grace → 3 days read-only → delete; 20GB = hard auto-delete. Note an IDLE-based variant isn't measurable today anyway — no per-subgraph read/last-access tracking exists (usage counters are per-account; `subgraph-expiry-sweep` is x402-TTL teardown, not idle detection); enforcement side is real (`paused` status exists). Hygiene, not revenue.
7b. **Resolve the anon-parity inversion** §2 flags and §4 calls "our mistake" — give keyed Free a visibly better rate than the anon shared bucket (or lower the anon bucket). Cheap, makes account creation mean something; currently no recommendation addresses it.
8. **Dedicated/SLA tier as a productized flat SKU** ($1.5k+/mo: BYO-database, isolated capacity, 99.9% SLA, co-brand) — mempool.space charges $1,499–5,999 for exactly this shape; it's the anchor-partner deal the roadmap says $20k MRR needs, and it matches the founder's $1.5k ladder slot that currently has no Stripe price.
9. **Freshness tiers — skip.** No vendor in either market meters freshness; at most it's a reserved lever (Envio head-vs-historical) or enterprise packaging (Allium batch vs streaming). Not a norm; don't pioneer it.
10. **Dump egress pricing — skip for now.** R2 $0 egress makes free dumps a structural moat; charging fights free (AWS/BigQuery). Revisit only if dump-production compute becomes measurable.

Dimensions considered nowhere above, named for completeness: **Index history-depth/archive gating** (§2 notes depth is free-unbounded; archive-vs-full is a classic RPC axis — needs an option or a skip-rationale); **seats/projects/API-key counts** (Maestro charges project counts; we have projects/teams, never evaluated); **annual/commit discounts** (standard SaaS axis, absent); **mempool/unconfirmed-data access as tier differentiator** (we ship mempool cursors).

## 6. Pressure test

**Steelman the current model:**

- **Simplicity won on purpose.** Three lines, every claim enforced — that was the focus audit's correct answer to ~20 billable concepts and a checkout that 404'd. Tinybird and PlanetScale paid real money to learn that fixed, predictable tiers beat clever meters; Fivetran's per-connector metering triggered 40–70% bill hikes and public backlash. With ~0 paying customers, a metering system is infrastructure for revenue that doesn't exist.
- **$99 Pro isn't really selling req/s.** It sells "remove limits + private subgraphs + genesis backfill" — the rate number is the headline, not the substance. The two gates that DO exist (genesis, private) are cost-aligned and indexer-shaped.
- **The local market prices this way.** Hiro, Maestro, QuickNode-on-Stacks all sell rate+volume+counts. In-ecosystem price perception is anchored by Hiro's $0/900 RPM; our uncapped-volume free tier is a deliberate generosity wedge against the incumbent.
- **Cost-to-serve is flat-then-cliff.** Fixed boxes mean there is no marginal-cost slope to track with a meter; overload shows up as latency, not dollars. Metering precision buys nothing until the first hardware cliff (~$50–70/mo).
- **At Stacks scale, per-query revenue is tiny anyway.** At The Graph's $2/100k anchor, a healthy Stacks app doing 5M queries/mo = $98 ≈ Pro. Flat tiers + counts + enterprise-flat is arithmetically the right family for this ecosystem's volumes.

**The strongest case against:**

- **The model is unbounded on exactly the dimensions that cost money.** One Pro user can deploy 50 subgraphs, run genesis backfills on each, store 50M rows, hold 20 SSE tails open forever, and point a firehose subscription at a busy contract — for $99 flat, identical to a toy app. Under flat pricing with zero resource caps, our best customers are our worst customers. Goldsky would bill that user ~$2k/mo.
- **It's not even the RPC model — it's flatter.** Alchemy/QuickNode meter every call and only gate req/s. We have no usage meter at all on plans. Pure flat-rate SaaS with uncapped resources is the most exposed pricing shape in this market, and the one vendor who tried hosted subgraphs at API-company margins (Alchemy) exited the business.
- **The free tier bounds nothing.** Industry free tiers cap total cost (30M CU, 10M credits, 100k entities, pause-on-limit). Ours caps instantaneous rate only — uncapped volume, uncapped subgraphs, uncapped connections, no idle recycling. The only thing protecting prod from the open beta is obscurity.
- **We're ignoring our own analysis.** The two highest-priority, $0-cost levers (SSE caps, subgraph storage lever) were specified in-repo on 2026-06-07 and never built. That's not simplification; that's an unexecuted decision.
- **Capacity gates aren't metered billing.** The roadmap ruling defers METERS until 10 paying accounts — it says nothing against caps. Slots, SSE limits, and row allowances are tier definitions, not billing infrastructure; conflating the two has stalled the cheap fixes.

## 7. Recommendation

Tiers are LOCKED (Free / Pro $99 / Enterprise custom per STRATEGY.md; `scale` $299 stays a code-only manual-deal vehicle, not a public tier). The change is what the tiers CONTAIN. Principle: **rate tiers stay for Index reads (shared-cost — they're honest there); resource caps move to the front for Subgraphs/Streams/Subscriptions (per-tenant cost); meters stay off until ≥10 paying accounts, then flip the two that are already counted.**

**Phase 1 — capacity gates, no billing changes (build now, ~$0 each):**

| Dimension | Free | Pro $99 | Enterprise (incl. manual-deal `scale`) |
|---|---|---|---|
| Index req/s (keep) | 100 | 250 | custom (scale plan: 500) |
| Streams req/s (keep — note 10, not 100: `streams/tiers.ts:35`) | 10 | 250 | custom (scale plan: 500) |
| **Concurrent SSE/stream tails (NEW)** | 2 | 10 | custom |
| **Active subgraph slots (NEW)** | 3 | 10 | custom |
| **Stored rows across subgraphs (NEW, soft cap → pause; BYO deploys excluded — rows on customer Postgres)** | 250k | 5M | custom |
| Genesis/full-history backfill (keep) | — | ✓ | ✓ + priority |
| Private subgraphs (keep) | — | ✓ | ✓ |
| Webhook subscriptions (keep) | 3 | 25 | ∞ |
| Streams retention (keep, demote from headline) | 7d | 30d | 90d+/∞ |
| **Free-subgraph auto-recycle (NEW hygiene, age/usage-based per Envio mechanism)** | ✓ | — | — |

(Plan-id mapping: Free=`none`, Pro=`launch`, Enterprise=`enterprise` with `scale` as the manual-deal stepping stone; streams tier configs separately say free/build/scale — Phase 1 implementation must pick the mapping explicitly.)

Numbers are illustrative AND ungrounded — first pull actual prod usage (subgraphs/account, rows/tenant schema, peak SSE tails, delivery volumes; all queryable today), then calibrate so real usage fits Free and Pro is ~10x. Build-cost honesty per dimension: subgraph slots fit the existing `plan-limits.ts` pattern (genesis/private/sub-quota + exempt allowlist) — genuinely cheap; rows-returned meters already emit. But the SSE cap is days of work (no connection tracking; see §5 #1), the stored-rows cap needs a NEW measurement job (`measureStorage()` is dead code — zero callers, measures bytes not rows, writes `usage_snapshots` nothing populates; "row counts queryable per tenant schema" is true in principle only) plus a soft-cap/pause trigger, and auto-recycle needs per-subgraph read instrumentation if any usage signal is wanted (none exists; `paused` status does). Also unhandled here: **sybil** (free caps trivially multiplied via new accounts — no identity/abuse control proposed) and **grandfathering** (no migration/comms plan for existing deployments exceeding new caps beyond "calibrate to fit").

**Phase 2 — at ≥10 paying accounts (per roadmap ruling), flip the meters:**
- Index rows returned: $4/100K over a Pro allowance (counter exists AND emits; needs Stripe meter only).
- Webhook deliveries: $1/100K over allowance — NOT "same": `usage_daily.deliveries` is never written (zero increment callsites; delivery facts live only in `subscription_deliveries`). Needs counter wiring + emit + Stripe meter. Also decide whether direct chain subscriptions (no per-tenant schema, different cost profile) price identically to subgraph subscriptions or split.
- Spend-cap path is real (account-spend-caps + daily spend-cap-alert cron with Stripe upcoming-invoice freeze) — it finally governs something.

**Phase 3 — opportunistic / on first demand:**
- Heavy backfill beyond Pro entitlement as a one-time priced job (per-block or flat-per-backfill).
- Productize the Enterprise slot as flat dedicated/SLA/BYO-database SKU at the founder's $1.5k anchor (mempool.space shape).
- x402 unchanged: gas-floor per-call for accountless agents; consider per-route weights later (Index read < Streams cursor page) to complete the CU shape.

**Explicitly do NOT:** change price points; meter query compute or GB-scanned (Tinybird/PlanetScale retreat); charge for dumps (R2 $0 egress = moat, raw data is funnel); sell freshness tiers (no market norm); add a per-subgraph base fee on Free (The Graph/Goldsky funnel lesson — slots cap is enough); per-request price Subgraphs reads.

One sentence for the pricing page when this lands: Free = try everything small; Pro = your real app (private, history, 10 subgraphs, 5M rows); Enterprise = your own lane.

## 8. Open questions for the founder

1. **Are capacity caps (slots/SSE/rows) inside or outside the "no metered billing until 10 paying accounts" ruling?** This audit treats them as tier definitions (outside). If you read them as metering, Phase 1 collapses to hygiene only.
2. **Slot/row numbers:** is Free = 3 subgraphs / 250k rows generous enough for the Explore seeding + grant-demo story? (Exempt-account allowlist already bypasses gates for first-party.)
3. **`scale` plan disposition:** it's a code-only manual-deal vehicle at $299 (STRATEGY.md confirms not public). Keep it as the named stepping stone between Pro and Enterprise for design-partner deals, or delete the plan id and do those deals as custom Enterprise? (No price drift exists — the $499 in earlier drafts was the superseded June-9 roadmap proposal.)
4. **Free-tier auto-recycle:** comfortable recycling free subgraphs Envio-style (age/usage-based: 30d max lifespan + soft event/storage limits → notify → read-only → delete)? It's the cheapest standing-cost control but it's also deleting user work.
5. **Does the $1.5k Enterprise slot become a real productized dedicated/SLA SKU this year** (the anchor-partner shape), or stay pure contact-sales?
6. **Backfill monetization appetite:** keep genesis as a binary Pro gate, or price heavy backfills as one-time jobs when someone actually asks for a 5-year backfill?
7. **Monthly request volume on Index:** add a soft req/mo number per tier (Hiro pattern) now, or leave volume uncapped as the deliberate anti-Hiro wedge until abuse appears? Named plainly: per-account volume caps can't touch the anon lane (open beta = no read auth) — most of the theoretical ~260M req/mo exposure lives there.
8. **x402 vs free-tier coherence:** what does $0.001/call buy an agent that the free anon bucket doesn't? Does Pro undercut x402 above ~99k calls/mo by design?
9. **Public-subgraph read cost:** when Explore succeeds, who absorbs anon read load on popular public subgraphs — deployer's tier, a separate budget, or eat it as funnel?
10. **Revenue model:** what do Phase 1+2 actually yield against the $8–10k MRR self-serve target, and for which segment (agents vs dapp devs vs analysts)? This audit didn't model it.

---

## Sources appendix

**Internal:** `docs/pricing-scalability-analysis.md` (2026-06-07 — cost model, SSE wall, recommended hybrid); `docs/audits/focus-audit-2026-06-10.md` §5; `docs/audits/product-optimization-roadmap-2026-06-09.md`; `STRATEGY.md` (Pricing); `packages/platform/src/pricing.ts`; `packages/api/src/index/tiers.ts`; `packages/api/src/streams/tiers.ts` + `retention.ts`; `packages/api/src/subgraphs/plan-limits.ts` + `operation-weight.ts`; `packages/api/src/x402/{catalog,middleware,session}.ts`; `packages/api/src/routes/streams.ts` (SSE poll); `packages/subgraphs/src/schema/generator.ts` (per-tenant CREATE SCHEMA); `packages/subgraphs/src/service.ts`; `packages/platform/src/db/queries/{usage,account-spend-caps}.ts`; `packages/worker/src/jobs/{spend-cap-alert,subgraph-expiry-sweep}.ts`; `docker/SCHEMA_SPLIT.md`.

**Market (all fetched 2026-06-12 unless noted):**
- The Graph: thegraph.com/studio-pricing, /docs/en/subgraphs/billing, /docs/en/resources/tokenomics, GIP-0081 (Indexing Payments, live w/ Horizon 2025-12-11), Messari State of The Graph Q4 2025 (40:1 subsidy:query-fee ratio)
- Goldsky: goldsky.com/pricing, docs.goldsky.com/pricing/summary, Mirror GA post — entity storage $0.0053/hourly-unit per 100k entities at 100k–10M tier (≈$3.87/100k-mo ≈ ~$39/M-mo entry); $0.0014/unit (≈$10/M-mo) is the 10M+ volume tier only
- SQD: docs.sqd.dev/cloud/pricing (post-2026-04-01 +20%), sqd.ai/cloud, network FAQ
- Envio: envio.dev/pricing (tier data from live JS bundle — UNVERIFIED: no numbers server-side on pricing page or docs; confirmed only indexing-hour unit ~730 hrs = 1 deployment-month, free dev tier, and Development-plan hygiene = 30d max lifespan + 100k events/5GB soft limits → 7d notify + 3d read-only → delete, 20GB hard delete), docs.envio.dev hosted-service-billing
- Alchemy: alchemy.com/pricing, compute-unit-costs, subgraphs deprecation notice (sunset 2025-12-08), PAYG FAQ ($20/M queries + $25/M entities — DEFUNCT-PRODUCT pricing: Alchemy Subgraphs no longer exists; historical anchor only. Live Alchemy PAYG = $0.40–0.45 per 1M CU)
- QuickNode: quicknode.com/pricing, docs streams/cost-estimation (credits-per-block; STALE flag: 2024 per-GB GA model superseded)
- OnFinality/SubQuery: documentation.onfinality.io/support/pricing, network flex-plan docs (STALE flag: 2023 Medium pricing superseded)
- Ghost: tryghost.xyz/pricing
- Ponder/Marble: ponder.sh docs (private beta, page returned HTTP 402)
- Moralis: moralis.com/pricing; thirdweb: thirdweb.com/pricing
- Dune: docs.dune.com credit-system + billing + datashare
- Bitquery: bitquery.io/pricing + points docs (Commercial → sales since Jun 2024)
- Allium: allium.so datashares ("we don't meter queries"; $ ranges third-party hearsay); Coin Metrics community-data docs
- Flipside: sold data biz to SonarX, platform sunsets 2026-06-17 (cautionary tale)
- AWS Public Blockchain (requester-pays parquet); BigQuery public datasets (~$6.25/TiB on-demand; STALE flag on older $5/TB cites)
- Hiro: platform.hiro.so/pricing + Apr-2025 rate-limits blog (900 RPM free, unauth deprecation; 2023 post STALE). RENDER flag: pricing page server-side HTML shows "undefined requests / month" — numbers require headless render; confirmed exactly (free 900 RPM + 150K req/mo; $99 Build 3K RPM + 15M req/mo; also Scale $599 = 7K RPM + 75M req/mo, not used above)
- Maestro: gomaestro.org/pricing (compute credits, published overage, x402 + stablecoin subscriptions live)
- mempool.space/enterprise (Silver $1,499 / Gold $2,999 / Platinum $5,999 flat dedicated)
- Non-crypto analogues: algolia.com/pricing (records+searches), fivetran.com/pricing + MAR-backlash coverage, tinybird.co pricing + Jan-2025 model-change post, clickhouse.com cloud billing, elastic.co serverless pricing, supabase.com/pricing, planetscale.com/pricing (no row metering), inngest.com/pricing, trigger.dev/pricing
