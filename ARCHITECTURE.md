# Architecture

Second Layer is the data plane for Stacks. The system is organized as a stack of layered primitives, each one consuming the layer below and exposing a narrower, higher-level interface to the layer above. Every product in the platform is a thin surface over one of these layers.

This document describes the runtime architecture, the data layers, the delivery surfaces, and the operational posture. It is the durable reference; PRDs and sprint docs cite it.

---

## Design principles

1. **One pipeline, many products.** A single ingest path produces every dataset. Products are views, not separate stacks.
2. **Layered primitives.** Raw events → decoded transactions → user-defined subgraphs. Each layer is independently queryable and independently priced.
3. **Read-only at the edges.** Public surfaces are read APIs and managed subscriptions. We do not deliver webhooks from raw events; that lane belongs to Hiro Chainhooks.
4. **Expose data, not a database.** Customers don't inherit our storage choices. Subgraphs let them define their own schema; the SDK is decoupled from storage; downstream consumers are free to use Postgres, PlanetScale, Prisma, DuckDB, or whatever fits their stack.
5. **Calm infrastructure.** Hot-spare nodes, idempotent ingest, deterministic replays. Status page is the product.
6. **Generous to the ecosystem.** Foundation Datasets are public goods. SDKs and CLI are open source. We monetize hosted, supported infrastructure — not access to public chain data.

---

## Runtime topology

```
                       ┌──────────────────────────────────┐
                       │         Stacks node fleet         │
                       │  (primary + hot spare, Hetzner)   │
                       └──────────────┬───────────────────┘
                                      │ events, blocks, microblocks
                                      ▼
                       ┌──────────────────────────────────┐
                       │            Indexer                │
                       │  packages/indexer (Rust/TS)       │
                       │  - block follower                 │
                       │  - reorg handler                  │
                       │  - event decoder                  │
                       └──────────────┬───────────────────┘
                                      │
                ┌─────────────────────┼─────────────────────┐
                ▼                     ▼                     ▼
        ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
        │   L1 Store   │      │   L2 Store   │      │   L3 Store   │
        │  raw events  │      │  decoded tx  │      │  subgraphs   │
        │  (Postgres)  │      │  (Postgres)  │      │  (per-tenant │
        │              │      │              │      │   Postgres)  │
        └──────┬───────┘      └──────┬───────┘      └──────┬───────┘
               │                     │                     │
               └──────────┬──────────┴──────────┬──────────┘
                          ▼                     ▼
                  ┌───────────────┐     ┌───────────────┐
                  │   Read API    │     │ Subscriptions │
                  │ packages/api  │     │  (managed)    │
                  └───────┬───────┘     └───────┬───────┘
                          │                     │
                          ▼                     ▼
                  ┌───────────────────────────────────┐
                  │  SDK · CLI · MCP Server · Console  │
                  └───────────────────────────────────┘
```

---

## Data layers

### L1 — Stacks Streams

Raw, ordered, append-only chain events. The lowest layer the platform exposes.

- **Source:** Indexer block follower, post-reorg-resolution.
- **Shape:** `{ block_height, index_block_hash, tx_id, event_index, event_type, payload, ts }`.
- **Access:**
  - Cursor-paginated read API. Cursors are `(block_height, event_index)` tuples; stable across replays.
  - Canonical-state lookup: `GET /canonical/{height}` returns the canonical `index_block_hash` so external indexers can self-heal without replaying our entire reorg history.
  - Bulk parquet dumps on S3, refreshed continuously. Backfillers `aws s3 sync` for historical, then tail the cursor API from a recent point. Same pipeline that feeds Datasets.
- **Guarantees:** At-least-once during reorgs (clients dedupe by cursor); strict order within a block; reorg events emitted as explicit `chain.reorg` markers.
- **Retention:** 90 days hot, full archive cold (S3 dumps).
- **Not in scope:** Push delivery, webhooks, filter DSLs. Hiro Chainhooks owns that lane.

### L2 — Stacks Index

Decoded transactions and contract calls. The layer most app developers actually want.

- **Source:** L1 + ABI registry. Decoders are versioned; re-decoding is a deterministic replay over L1.
- **Shape:** Normalized tables for `transactions`, `contract_calls`, `ft_events`, `nft_events`, `print_events`, `stx_transfers`.
- **Access:** REST endpoints with the standard query grammar (filter, sort, paginate). SQL read replica available on Scale and Enterprise.
- **Guarantees:** Decoded view is eventually consistent with L1; lag SLO published on status page (target <5s p95).

### L3 — Stacks Subgraphs

User-defined materialized views over L1+L2. Tenants write a subgraph manifest; the platform compiles it, backfills, and keeps it tailing.

- **Source:** Subgraph runtime (`packages/subgraphs`), consuming L1 events and L2 decoded calls.
- **Shape:** Tenant-defined schema. Stored in per-tenant Postgres for isolation.
- **Access:** REST endpoint per subgraph, with the platform's standard filter/sort/paginate query grammar. SQL read access on Scale+.
- **Operations:** Backfill jobs are checkpointed and resumable; auto-pause after 7 days of zero queries on Free tier.

---

## Delivery surfaces

These are the products users interact with. Each is a thin layer over the data layers above.

| Surface | Layer | Transport | Purpose |
|---|---|---|---|
| Stacks Streams API | L1 | HTTPS, cursor pagination | Raw event feed for indexers, archivers, custom pipelines |
| Stacks Index API | L2 | HTTPS, REST | Decoded transactions and events for app developers |
| Stacks Subgraphs | L3 | REST | Materialized, app-specific views |
| Subscriptions | L2/L3 | Server-Sent Events, long-poll | Managed tail of any L2 query or L3 subgraph |
| MCP Server | L1/L2/L3 | Model Context Protocol | Read access for AI agents and IDEs |
| Stacks Datasets | L2 | Public read API + downloads | Curated public-good datasets |
| Console | — | Web UI | Dashboard, keys, billing, subgraph management |

Naming rule: every product is `Stacks <X>` except MCP Server. Never use "Stacks API" (ambiguous), "Indexer" as a product name (it's an internal component), "Chainhook" prefixes for our raw events (different lane), or "Streaming" for Subscriptions.

---

## Component map

This maps to the existing repo at `github.com/ryanwaits/secondlayer`.

| Package | Role |
|---|---|
| `packages/indexer` | Block follower, reorg handler, event decoder. Writes L1 and L2. |
| `packages/api` | Public HTTPS surface. Hosts Streams, Index, and Subscriptions endpoints. Auth, rate limit, billing hooks. |
| `packages/subgraphs` | Subgraph compiler, runtime, and per-tenant Postgres manager. |
| `packages/mcp` | MCP server. Wraps Index and Subgraph reads for agent consumption. |
| `packages/stacks` | Stacks-specific SDK primitives (encoders, ABI handling). Open source. |
| `packages/sdk` | Customer-facing TS/JS SDK. Open source. |
| `packages/cli` | `secondlayer` CLI: subgraph dev, deploy, log tail, dataset pulls. Open source. |
| `apps/console` | Web dashboard (planned, Phase 2). |

---

## Tenancy and isolation

- **Free / Build / Scale:** Shared L1, L2 read clusters. Per-tenant Postgres for L3 subgraphs.
- **Enterprise:** Dedicated read replicas optional. Per-tenant rate limits and quotas.
- **Partner Platform (Phase 4):** Multi-tenant management plane sold to platform owners (e.g., Hiro). Admin API for managing nested customers, templates, and aggregate billing.

Quota enforcement happens at the API gateway. Billing meters (rows scanned, webhook events delivered, subgraph storage) are emitted from the API and Subscription components and aggregated nightly.

---

## Reliability posture

- **Nodes:** Two Hetzner machines today (primary + hot spare). Failover is manual but rehearsed; target automated within Phase 1.
- **Reorg handling:** Indexer reverts L1 writes on reorg, replays from fork point, re-emits decoded L2 rows. Subscriptions emit explicit reorg markers.
- **Status page:** Public. Tracks node health, ingest lag, L2 decode lag, API p50/p95, error rate. Goes live in Phase 1.
- **SLAs:** None on Free. 99.5% target on Build. 99.9% on Scale. Custom on Enterprise.
- **Backups:** Postgres PITR, daily off-site snapshots, quarterly restore drills.

---

## Security and compliance

- API keys per tenant, scoped per product.
- All public traffic over TLS. Internal traffic over WireGuard between Hetzner hosts.
- No PII collected beyond billing email and account metadata.
- SOC2 deferred until an enterprise customer requires it. Note in sales conversations as "on roadmap, ready to start when contract value justifies it."

---

## What is explicitly out of scope

These are real and reasonable products. They are not on the current roadmap.

- **Wallet-facing primitives** (AddressSet, per-user subgraphs). Wallets are downstream of Hiro; we partner instead of compete here.
- **Webhook delivery from raw events.** Hiro Chainhooks owns the push lane. We do not rebuild it.
- **EVM and multi-chain.** Focus is Stacks until the Stacks position is unambiguous.
- **Marketplace v2** (third-party subgraph templates with revenue share). Revisit after Partner Platform ships.

---

## Decision log references

- Layered model and product names: locked in conversation, May 2026.
- Streams as read-only (no webhook delivery): resolved May 2026; Chainhooks lane preserved for Hiro.
- Wallet pivot dropped: May 2026, on grounds that Leather and Xverse already consume Hiro APIs and are not the right wedge.
- Pricing tiers (Free / Build $99 / Scale $499 / Enterprise): locked May 2026. See `PRODUCTS.md`.

---

*This document is durable. Update it when a layer or surface changes shape. PRDs in `docs/prds/` cite specific sections by anchor.*
