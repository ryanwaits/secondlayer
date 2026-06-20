# Charter: Index primitives vs. Subgraph dogfood

Status: adopted 2026-06-19. Supersedes ad-hoc per-feature decisions. New work cites this.

## Why this exists

The default reflex has been: a new decoded view → another bespoke `/v1/index/*` endpoint.
That is **core-API sprawl**, and it costs us:

1. We never dogfood the product we sell (Subgraphs), so we don't feel customer pain.
2. The canonical, maintained-forever surface bloats with opinionated, churny views.
3. Product iteration couples to backend deploys.
4. Product gaps stay hidden behind internal shortcuts.

The sBTC explorer reading core endpoints while a `sbtc-flows` subgraph sits unused is this
failure made visible.

## The Index test

> **"Does this ship a decoded-data primitive that makes building _indexers_ easier for any dev?"**
>
> Yes → `/v1/index/*`. It's custom / app-shaped / keyed to a curated set of specific contracts →
> **Subgraph + dogfood.**

`/v1/index` is reusable decoded **raw material** — more data options for people building their own
indexers. The moment something is an opinionated rollup, a scoreboard, or tied to a hand-curated
list of third-party contracts, it is a custom *application view* and belongs on the platform we sell.

## Two kinds of data work

| | Platform primitive (Index/Streams) | Application view (Subgraphs) |
|---|---|---|
| Nature | canonical decoded raw material | opinionated, app-shaped |
| Audience | every dev building an indexer | one app / page / customer |
| Lifecycle | maintained forever, versioned | churns with the product |
| Home | `/v1/index/*`, `/v1/streams/*` | `/v1/subgraphs/*` + aggregate reads |
| Examples | ft/nft/stx transfers, contract-calls, decoded sBTC registry events, tip/finality/reorg | sBTC-by-venue, whale alerts, dashboards, leaderboards |

## Decision procedure (default = subgraph)

Ask in order; stop at the first that fires:

1. **Already served by an existing surface?** → use it, build nothing.
2. **A decoded primitive any dev wants identically as indexer raw material?** → Index. (Rare; high bar.)
3. **Expressible as event handlers + read-time aggregate?** → **Subgraph. This is the default.**
4. **Needs semantics subgraphs can't express** (cross-event rollup, node read, finality gating)? →
   first try to **extend the subgraph model** (it helps customers too); land in core API **only** with
   an explicit written justification, never by default.

## No grandfathering

Nothing keeps its place by inertia. Every existing surface is re-justified against the Index test.
What fails becomes a subgraph; what genuinely needs core semantics (step 4) stays **only** with a
written reason. Inertia is not a reason.

## Guardrails

- **Our product pages run on what we sell.** App-views come from subgraphs; only primitives come
  from Index. If our own page can't be built on Subgraphs, that's a product bug to file, not a
  reason to reach into core API.
- **One canonical home per dataset.** No mirroring the same data in both Index and a subgraph unless
  the subgraph is an explicit, labeled *example*.
- **Use the engine's reorg-safe primitives for stored state.** `ctx.increment` (journaled,
  commutative accumulator) and journaled `ctx.update` revert correctly on reorg via the schema
  `_journal`; non-idempotent updates are rejected at deploy. Stored rollups built this way are safe
  and blessed. What's unsafe is hand-rolled totals *outside* this mechanism. Read-time aggregation
  over event-grain tables is also fine and often simpler — pick per case, but never hand-roll.
- **Promotion, not demotion.** Features start as subgraphs. A proven view can graduate *into* a core
  primitive with a maintenance commitment. Never default to starting in core API.

## Exceptions

- **Node-authoritative reads** (e.g. sBTC circulating supply via `get-total-supply`) can't be a
  subgraph handler and aren't decoded-event raw material. They live as thin primitive utilities,
  explicitly tagged as exceptions.

## Worked example: sBTC

- **Decoded registry events** (`sbtc/events`) → **Index primitive.** Raw material any sBTC indexer wants.
- **sBTC → venue destination flows / whale alerts** → **Subgraph.** Custom, keyed to a curated venue
  registry. Extend `sbtc-flows`; the explorer panel reads `/v1/subgraphs/sbtc-flows/*`, not a new endpoint.
- **`sbtc/summary` scoreboard** → fails the test (pure aggregate) → **subgraph** `increment` accumulators.
- **`sbtc/withdrawals` lifecycle** → status derived across create/accept/reject → **subgraph** table keyed
  by `request_id`, `update`d per event; the `_journal` makes it reorg-safe. (Not a step-4 case — the
  engine already supports reorg-safe stateful rollups. Hard-remove the endpoint.)
- **`sbtc/deposits`** → thin `topic=completed-deposit` filter → fold into `sbtc/events?topic=`. Removed.
- **`pox/cycles`** → per-cycle aggregate → migrate onto the existing `pox-stacking` subgraph.
- **sBTC supply** → node read → exception utility (the one piece that can't be dogfooded).
