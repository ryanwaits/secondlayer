# Products

Second Layer ships a small, opinionated set of products. Every product is a thin surface over a data layer defined in `ARCHITECTURE.md`. This document is the canonical product catalog: what each product is, who it's for, what it costs, and what it explicitly is not.

---

## Catalog

| Product | Layer | Audience | Status |
|---|---|---|---|
| Stacks Streams | L1 | Indexers, archivers, infra teams | Phase 1 |
| Stacks Index | L2 | App developers | Phase 1 |
| Stacks Subgraphs | L3 | App developers building custom views | Live |
| Subscriptions | L2 / L3 | App developers needing tail/push semantics | Live |
| MCP Server | L1 / L2 / L3 | AI agents, IDE integrations | Live (hosted on Scale+) |
| Stacks Datasets | L2 | Ecosystem, researchers, dashboards | Phase 2 |
| Console | — | All paid tenants | Phase 2 |
| Partner Platform | All | Platform owners (e.g., Hiro) | Phase 4 |

---

## Stacks Streams

Raw, ordered, append-only Stacks chain events. Two access modes — cursor API for tailing, parquet dumps for backfill.

- **What it is.** Every event the chain emits, in order, with a stable cursor. The lowest-level surface we expose.
- **What it isn't.** A webhook system. A filter DSL. A push channel. If you need push, see Hiro Chainhooks or our Subscriptions product on top of Index/Subgraphs.
- **Who uses it.** Teams building their own indexers, archivers, analytics pipelines, or custom decoders. Researchers pulling historical events.
- **Shape.**
  - `GET /v1/streams/events?cursor=<height>:<index>&limit=...` — cursor-paginated tail. Returns events with `block_height`, `index_block_hash`, `tx_id`, `event_index`, `event_type`, `payload`, `ts`.
  - `GET /v1/streams/canonical/{height}` — canonical block hash lookup, so external indexers can self-verify without replaying our reorg history.
  - **Parquet bulk dumps** on S3 (Phase 2). `aws s3 sync` historical events, then tail the cursor API from a recent cursor. Most backfill workloads belong here, not in the API.
- **Guarantees.** At-least-once across reorgs, deduped by cursor. Strict in-block order. Explicit `chain.reorg` markers.
- **Limits.** Free: 7-day window, 10 req/s. Build: 30-day window, 50 req/s. Scale: 90-day window, 250 req/s. Enterprise: full archive, custom. Parquet dumps included on Build and above.

## Stacks Index

Decoded transactions and contract events as a REST API.

- **What it is.** Every Stacks transaction, decoded against the registered ABIs. Normalized tables for transfers, contract calls, FT/NFT events, prints.
- **What it isn't.** A custom view engine. For app-specific shapes, use Subgraphs.
- **Who uses it.** App developers, dashboards, explorers, anyone who wants "show me all sBTC transfers for address X" without writing decoders.
- **Shape.** REST. Standard filter/sort/paginate grammar. SQL read replica on Scale+.
- **Guarantees.** Eventually consistent with L1, target lag <5s p95, published on status page.

## Stacks Subgraphs

User-defined materialized views.

- **What it is.** You write a subgraph manifest (entities, mappings, event handlers). We compile, backfill, and tail it. You query via REST, with the platform's standard filter/sort/paginate grammar.
- **Who uses it.** App teams whose data shape doesn't fit the Index defaults: marketplaces, lending protocols, custom analytics.
- **Lifecycle.** `secondlayer subgraph init` → `dev` → `deploy`. Backfill is checkpointed and resumable. Auto-pause after 7 idle days on Free.
- **Limits.** Free: 1 subgraph, 100K rows. Build: 5 subgraphs, 2M rows. Scale: 25 subgraphs, 25M rows. Enterprise: custom.

### Templates

A shelf of starter subgraphs you can clone and deploy. Phase 2.

- **Stacking Indexer** — PoX-4 cycles, delegations, signer metrics.
- **SIP-009 Metadata** — any contract conforming to the SIP-009 NFT trait, decoded with metadata resolution.
- **SIP-010 Token Activity** — transfers, holders, supply over time for any SIP-010 fungible token.
- **NFT Sale Watcher** — sales across known marketplace contracts, normalized.
- **Mempool Tracker** — pending transactions matching a filter, suitable for bot/notification use cases.

Templates are open source. Deploying them is the standard subgraph flow.

## Subscriptions

Managed tail of any Index query or Subgraph.

- **What it is.** A server-managed subscription that delivers new matching rows as they're indexed. Transports: Server-Sent Events, long-poll. Webhook delivery is opt-in and rate-shaped.
- **What it isn't.** A general-purpose webhook system over raw chain events. Subscriptions sit on decoded data (L2) or app-defined data (L3) — not L1.
- **Who uses it.** Apps that need "notify me when a row matching this filter appears" without running their own poller.
- **Limits.** Free: 1 subscription, SSE only. Build: 10 subs, 1M webhook events/mo. Scale: 100 subs, 10M webhook events/mo. Enterprise: custom.

## MCP Server

Stacks data for AI agents and IDEs, over the Model Context Protocol.

- **What it is.** A hosted MCP endpoint exposing read tools over Index and Subgraphs. Drop into Claude Code, Cursor, or any MCP-compatible client.
- **Who uses it.** Developers who want their agent to query chain data without bespoke tool-writing.
- **Tier.** Hosted on Scale and Enterprise. Self-host package available open source for Free/Build.

## Stacks Datasets

Curated, public-good datasets maintained by Second Layer.

- **What it is.** A small shelf of canonical, query-ready datasets. Five for v1: STX transfers, PoX-4 / Stacking, sBTC, BNS, network health.
- **Why we ship it.** Public good for the ecosystem; demand-generation for paid products; concrete artifact for the Stacks Foundation grant pitch.
- **Access.** Free read API, parquet downloads on S3, dashboard. Heavy programmatic use rolls into paid tiers. Same parquet pipeline that powers Streams bulk dumps.
- **Future.** NFT marketplaces, DeFi protocols, mining stats. Driven by ecosystem demand and Foundation input.

## Console

The web dashboard.

- API keys, usage metrics, billing, subgraph management, subscription management, dataset browser.
- Phase 2. Until then, CLI + email is the management surface.

## Partner Platform

Multi-tenant management for platform owners.

- **What it is.** A tenancy plane that lets a partner (e.g., Hiro) provision, meter, and bill nested customers on Second Layer infrastructure. Admin API, templates, aggregate dashboards, contract-grade SLAs.
- **Who uses it.** One or two platform partners, not end developers.
- **Phase 4.** Predicated on Phase 3 outcomes (Foundation grant, Hiro one-pager response). If neither lands, revisit positioning.

---

## Pricing

| Tier | Price | Subgraphs | Index rows / mo | Webhook events / mo | Streams window | MCP hosted | SLA |
|---|---|---|---|---|---|---|---|
| Free | $0 | 1 (auto-pause 7d) | 100K | — | 7 days | self-host | best effort |
| Build | $99 / mo | 5 | 2M | 1M | 30 days | self-host | 99.5% |
| Scale | $499 / mo | 25 | 25M | 10M | 90 days | hosted | 99.9% |
| Enterprise | $1.5K – $5K+ / mo | custom | custom | custom | full archive | hosted | custom |

**Overages.** $4 per additional 100K Index rows. $1 per additional 100K webhook events. Subgraph storage above tier billed at $0.50/GB-month.

**Trial.** 30-day free trial on Build and Scale. No credit card required to start; required to convert.

**Free tier intent.** Free is for evaluation, hobby projects, and ecosystem goodwill. Auto-pause on idle keeps cost honest. We do not gate the SDK, CLI, or self-host MCP behind a paywall.

---

## What we don't sell

State this plainly. It is part of the product.

- **Webhook delivery from raw chain events.** That is Hiro Chainhooks' lane. Subscriptions sit on decoded data, not raw events.
- **Wallet-side primitives.** AddressSet, per-user feeds, wallet SDKs. Wallets consume Hiro; we partner with that flow rather than compete.
- **EVM, Bitcoin L1, or other L2s.** Stacks-only until the Stacks position is unambiguous.
- **A subgraph marketplace with revenue share.** Templates yes, marketplace no — until Partner Platform proves out.
- **A node-as-a-service product.** Running Stacks nodes is internal infrastructure, not a product line.

---

## Positioning notes

- We are the **data plane for Stacks**. Hiro is the **developer platform**. Most teams will use both. Many will not realize they're using us — they'll be using a Hiro-branded surface backed by our infrastructure. That is fine and intended.
- Foundation Datasets are the public face. Subgraphs are the wedge. Partner Platform is the ceiling.
- Voice: calm infrastructure. Short declarative sentences. No "vs Hiro." No exclamation points. Generous to the ecosystem.

---

*Update this catalog when a product ships, sunsets, or changes tier. PRDs in `docs/prds/` are the per-product source of truth for surface details and acceptance criteria.*
