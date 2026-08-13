# Secondlayer Strategy

> Single source of truth for what we build and why. Supersedes the former
> VISION / PRODUCT / PRODUCTS / ROADMAP / ARCHITECTURE docs (deleted 2026-06-11;
> see git history). If marketing, docs, or code contradict this file, this file wins.
> Grounding analysis: `docs/internal/audits/focus-audit-2026-06-10.md` (internal, untracked).

## The product, one sentence

Secondlayer is a self-hosted Stacks data runtime: run it beside your node,
bootstrap verified history, query decoded data, deploy TypeScript subgraphs.
We operate one public utility — a signed canonical archive on R2 — and we
sell metered access to the expensive bits: bootstrap, backfill, reindex.

## Three products

Everything we market is one of these three. Everything else is a feature of them.

**Index** — decoded chain data on your instance. Query events, transfers,
blocks, transactions over REST with a cursor envelope — or build your own app
index on the same rows: a checkpointed `consume()` loop with automatic cursor
rewind on reorg (`onReorg` rolls back your own rows), `walk()` sweeps,
`from_height=0` backfill, `/canonical`, `sl index codegen` for your mirror
schema. Built on Streams (our decoder is a Streams consumer). App index
without writing decoders.

**Subgraphs** — your schema on your instance. `defineSubgraph()` in one TypeScript
file → deploy → Postgres tables behind the same `/v1` read API. We do not host
subgraphs. Monetization is the archive work that fills them, not the query API.

**Streams** — the raw signed event firehose + parquet dumps. The inputs, not our
decoding: cursor-paginated REST, SSE tail, signed manifests, replay from any
height. For data/infra engineers building their own indexer or ETL. Also the
internal data plane the decoders and subgraphs ride.

### Features (not products)

- **Subscriptions** — webhooks on any subgraph table or raw chain event. The
  push channel for the products. Keeps its name; never a nav-level product.
- **Subgraph templates** — example definitions in `subgraphs/` (sBTC, PoX, BNS,
  …). Operators copy them onto their instance. Not a hosted directory. Explore
  as our live catalog is withdrawn as a product.
- **Contract discovery** — `/v1/contracts`: find deployed contracts by trait
  (SIP-009/010/013), pull ABIs. Connective tissue: feeds scaffold and Index queries.
- **Verification** — what we hand you is signed and the SDK verifies by default:
  dump manifests, **live Streams reads** (ed25519 `X-Signature` on REST + per-frame
  SSE; lenient by default so unsigned self-host still works, `verify: true` for
  strict), and webhooks (universal ed25519 on every format; the default
  `standard-webhooks` format adds a per-subscription HMAC). Index REST reads are
  not response-signed yet (deferred — see ROADMAP). The counterpart to "build
  your own" — replay and check us.

### Channels (not features)

How you reach the products, never product nouns: REST + OpenAPI (the contract),
CLI, SDK, MCP server (distribution for agents; golden-path tools only).

## Index vs Streams — who uses which

This distinction is load-bearing; keep it crisp everywhere:

| | Index | Streams |
|---|---|---|
| What | Decoded chain data, kept indexed | Raw signed event firehose + dumps |
| We do | Run the chain indexer and decoder | Hand you the inputs |
| You do | Query over REST — or build your app index on the rows | Build and run your own indexer/ETL from raw |
| Who | App devs, agents, dashboards | Data/infra engineers, indexer builders |
| Verify | Trust our decoding (+ inclusion proofs) | Signed manifests, replay from any height |

Both are indexer products at different levels: Streams is raw, low-level
indexing — Index is app-level indexing on decoded rows. Streams powers Index:
our decoder is itself a Streams consumer. Subgraphs is the Index loop, on your
machine. We sell archive bootstrap, not hosted compute.

One line for docs: *Reading decoded data? Index. Building your own app index on
decoded rows? Also Index — walk + cursors + reorgs[]. Your schema on your
instance? Subgraphs. Raw inputs? Streams.*

## The golden path

`docker compose up` → `sl instance bootstrap` from the official archive →
`sl subgraphs create` → deploy → curl your table on localhost → attach a
webhook. Forward-only from your own node is free and skips bootstrap.

## Pricing

Not a monthly service. The runtime is MIT. We run the archive; we meter the
bytes and rebuild work that come off it.

| Billable | Not billable |
| --- | --- |
| Official-archive bootstrap (genesis or a large range) | Self-host runtime, compose, CLI |
| Data-avail backfill / reindex that reads our archive | Forward-only indexing from the operator's node |
| | `sl verify` / `sl repair` against public manifests |

Meter unit is still open (bytes vs rows vs height-range). Charge at fetch
time with a gated archive URL — partitions stay content-addressed; unpaid
clients do not get the objects. No $99/mo Pro SKU.

We do not host public subgraphs, an Explore catalog, or a public query API.
Leftover hosted deploys are not a product; do not add more. Do not delete
billing code in Phase 6 if the archive meter still needs it; strip monthly-plan
UX, keep a meter.

## x402 (experimental)

Operator-owned optional paywall on *their* instance (HTTP 402, STX/sBTC/USDCx).
Off by default. They set recipients, assets, prices, and settlement. We are
not the merchant. Parked until public-read bind exists (writes tokened, `/v1`
open). Not a Secondlayer revenue line. Hosted prices, wallet-ghosts, and
7-day TTL must not ship in OSS.

## Operating rules

- **Parity firewall** — a new capability ships as a REST route + OpenAPI entry
  ONLY. SDK/CLI/MCP wrappers are added on first external request, generated not
  hand-mirrored. Releases batch weekly.
- **Frozen periphery** — shipped-but-unused surfaces (BYO plane, multi-ORM
  codegen, aggregates, proofs, CLI devnet/local, stacks-SDK wallet half (except
  supported nonce coordination)) stay shipped, lose docs prominence, and get
  zero further investment. Delete on first maintenance touch.
- **Demand before supply** — features unfreeze on a named external request, not
  on taxonomy or completeness arguments.
- **GTM is founder-led** — the prospect universe is ~30-80 funded Stacks teams.
  Templates of *their* contracts, run on their instance, are the outbound asset.

## Team & infra reality

1-2 people. One Hetzner box (+ own stacks-node), docker compose, push-to-main
deploys. Every product noun costs a which-door decision for every user and a
parity tax on us; the default answer to new surface area is no.
