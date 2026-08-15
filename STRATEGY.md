# Secondlayer Strategy

> Single source of truth for what we build and why. Supersedes the former
> VISION / PRODUCT / PRODUCTS / ROADMAP / ARCHITECTURE docs (deleted 2026-06-11;
> see git history). If marketing, docs, or code contradict this file, this file wins.

## The product, one sentence

Secondlayer is a self-hosted Stacks data runtime: run it beside your node,
bootstrap verified history, query decoded data, deploy TypeScript subgraphs.
We operate one public utility — a signed canonical archive on R2 — and we
sell metered access to the expensive bits: bootstrap, backfill, reindex.

That sentence is for us. What we say to a reader is in **Voice** below.

## Voice

Canonical for every reader-facing surface: marketing, docs prose, blog, npm
descriptions, CLI `--help`, MCP tool descriptions, READMEs. Code blocks,
tables, and CLI examples stay exactly as technical as they need to be. Prose
carries the why, examples carry the how.

**The anchor** (set 2026-08-15, after the positioning audit):

> Any serious app needs data a general-purpose API can't serve, and shouldn't
> have to. This is the layer underneath, so you can shape it yourself.

"…and shouldn't have to" is load-bearing. The gap is structurally correct, not
somebody's failure. A general API indexes what's general, and your contract is
specific by definition. Never name a competitor to make the point.

**Six rules. Each is checkable, so a reviewer can reject a line without
arguing taste.**

1. **Lead with the reader's job, not an architecture noun.** Banned as openers:
   runtime, surface, firehose, plane, decoded events, cursor envelope. The test:
   read it to someone who has never heard of Stacks indexing. "…what is that?"
   fails; "oh, I've had that problem" passes.
2. **Possessives track operation, not authorship.** If the sentence were true,
   would we have an uptime obligation? "Our archive" passes: we run it. "Our
   REST" fails: it runs on their box. Say *generated*, *out of the box*, *an
   API you didn't write*. Same for "our API", "our endpoints", "our instance".
3. **Never borrow a vocabulary another category owns.** `ask · any question ·
   answered · chat · prompt · copilot` reads as an LLM product. We ship a
   database. Check the category a line implies, not only what it means.
4. **Say the tradeoff out loud.** "Subgraphs gives you a REST API you didn't
   write. That's the point, and the tradeoff." Naming a limit earns more trust
   than hiding it, and pre-empts the "it forced its API on me" review.
5. **No em dashes in prose.** Commas, periods, or parentheses.
6. **Never make the reader pick a door.** One fork, on a criterion they already
   know about themselves ("Do you already have an API layer?"), never a menu of
   our product nouns. "Pick your surface" was the failure this replaced.

**Also:** the business model never appears in a first sentence. Price belongs
on the page about price.

Tooling that applies this: the `write-docs` skill (docs pages) and the
`writing` skill (blog). Both defer to this section.

## Three products

Everything we market is one of these three. Everything else is a feature of them.

**Index** — decoded chain data on your instance. Query events, transfers,
blocks, transactions over REST with a cursor envelope — or build your own app
index on the same rows: a checkpointed `consume()` loop with automatic cursor
rewind on reorg (`onReorg` rolls back your own rows), `walk()` sweeps,
`from_height=0` backfill, `/canonical`, `secondlayer index codegen` for your mirror
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
- **Subgraph scaffolding** — `secondlayer subgraphs create --from-contract <id>`
  infers sources, schema, and handlers from a contract's observed print events.
  With no flag it emits one empty starter. The five hand-written templates and
  the `subgraphs/` directory were retired 2026-08-15; new examples, when they
  come back, are written against the self-host path.
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

`docker compose up` → `secondlayer bootstrap` from the official archive →
`secondlayer subgraphs create` → deploy → curl your table on localhost → attach a
webhook. Forward-only from your own node is free and skips bootstrap.

## Pricing

Not a monthly service. The runtime is MIT. We run the archive; we meter the
bytes and rebuild work that come off it.

| Billable | Not billable |
| --- | --- |
| Official-archive bootstrap (genesis or a large range) | Self-host runtime, compose, CLI |
| Data-avail backfill / reindex that reads our archive | Forward-only indexing from the operator's node |
| | `secondlayer verify` / `secondlayer repair` against public manifests |

Meter unit is still open (bytes vs rows vs height-range). Charge at fetch
time with a gated archive URL — partitions stay content-addressed; unpaid
clients do not get the objects. No $99/mo Pro SKU.

We do not host public subgraphs, an Explore catalog, or a public query API.
Leftover hosted deploys are not a product; do not add more. Do not delete
billing code in Phase 6 if the archive meter still needs it; strip monthly-plan
UX, keep a meter.

## x402 — deleted

The pay-per-call rail is gone (~4,650 LOC across api/sdk/shared/stacks/worker,
plus the wallet-ghost accounts and the 7-day paid-deploy TTL). It was never a
Secondlayer revenue line, and in practice it shipped the three things this file
forbade in OSS: a hardcoded USD price catalog with no operator override, ghost
accounts, and the TTL. Do not reintroduce it as a Secondlayer-operated rail. An
operator-owned paywall on *their* instance remains a legitimate idea, but it
belongs behind a named external request, with the operator as the merchant.

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
