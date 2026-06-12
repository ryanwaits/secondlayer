# Secondlayer Strategy

> Single source of truth for what we build and why. Supersedes the former
> VISION / PRODUCT / PRODUCTS / ROADMAP / ARCHITECTURE docs (deleted 2026-06-11;
> see git history). If marketing, docs, or code contradict this file, this file wins.
> Grounding analysis: `docs/audits/focus-audit-2026-06-10.md`.

## The product, one sentence

Secondlayer is the hosted indexer for Stacks: curl decoded chain data keyless in
ten seconds, or deploy a one-file TypeScript indexer and get your own hosted
Postgres tables behind a public REST API — no node, no infra.

## Three products

Everything we market is one of these three. Everything else is a feature of them.

**Index** — indexer-as-a-service. We run the indexer; you query decoded Stacks
data (events, transfers, blocks, transactions) over REST with a cursor envelope.
Keyless. For app devs and agents who want answers tonight, not infrastructure.

**Subgraphs** — your schema on our indexer. `defineSubgraph()` in one TypeScript
file → deploy → hosted Postgres tables behind the same public `/v1` read API.
The monetization core: private subgraphs, genesis backfill, and scale live here.

**Streams** — the raw signed event firehose + parquet dumps. The inputs, not our
decoding: cursor-paginated REST, SSE tail, signed manifests, replay from any
height. For data/infra engineers building their own indexer or ETL. Also the
internal data plane the decoders and subgraphs ride.

### Features (not products)

- **Subscriptions** — webhooks on any subgraph table or raw chain event. The
  push channel for the products. Keeps its name; never a nav-level product.
- **Explore** — the public directory of subgraphs. Social proof + distribution;
  every card is a live API.
- **MCP server** — distribution channel for agents, not a product noun. Golden-path
  tools only.

## Index vs Streams — who uses which

This distinction is load-bearing; keep it crisp everywhere:

| | Index | Streams |
|---|---|---|
| What | Decoded, queryable chain data | Raw signed event firehose + dumps |
| We do | Run the indexer for you | Hand you the inputs |
| You do | Query over REST | Build and run your own indexer/ETL |
| Who | App devs, agents, dashboards | Data/infra engineers, indexer builders |
| Verify | Trust our decoding | Signed manifests, replay from any height |

One line for docs: *querying? Index. Building your own indexer? Streams. Want
your own schema without building anything? Subgraphs.*

## The golden path

Homepage curl → decoded JSON in <10s, keyless → `sl subgraphs create` from a
template → edit one file → deploy (recent-block start by default) → output
prints the public curl URL for your new table → attach a webhook. Five concepts:
decoded event + cursor, the subgraph file, deploy, public table URL, webhook.

## Pricing

Three lines; every claim enforced in code or it doesn't go on the page.

- **Free** — keyless reads, public subgraphs, forward-only indexing.
- **Pro $99/mo** — private subgraphs, genesis backfill, 250 rps, webhooks at scale.
- **Enterprise** — contact us. (Scale exists in code for manual deals only.)

No metered billing until ≥10 paying accounts; invoice overage manually.

## x402 (experimental)

The pay-per-call rail (HTTP 402, STX/sBTC/USDCx) is live as a **beta** for the
agent-native thesis: agents pay per call with no signup. Deliberately down-low —
documented at `/docs/x402`, discoverable via OpenAPI `x-x402` + `.well-known`,
absent from the pricing hero. It leads our agent story; it is not a revenue line.

## Operating rules

- **Parity firewall** — a new capability ships as a REST route + OpenAPI entry
  ONLY. SDK/CLI/MCP wrappers are added on first external request, generated not
  hand-mirrored. Releases batch weekly.
- **Frozen periphery** — shipped-but-unused surfaces (BYO plane, multi-ORM
  codegen, aggregates, proofs, CLI devnet/local, stacks-SDK wallet half) stay
  shipped, lose docs prominence, and get zero further investment. Delete on
  first maintenance touch.
- **Demand before supply** — features unfreeze on a named external request, not
  on taxonomy or completeness arguments.
- **GTM is founder-led** — the prospect universe is ~30-80 funded Stacks teams.
  Explore-seeded subgraphs of *their* contracts are the outbound asset.

## Team & infra reality

1-2 people. One Hetzner box (+ own stacks-node), docker compose, push-to-main
deploys. Every product noun costs a which-door decision for every user and a
parity tax on us; the default answer to new surface area is no.
