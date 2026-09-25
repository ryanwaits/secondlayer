# Secondlayer Strategy

> Single source of truth for what we build and why. Supersedes the former
> VISION / PRODUCT / PRODUCTS / ROADMAP / ARCHITECTURE docs (deleted 2026-06-11;
> see git history). If marketing, docs, or code contradict this file, this file wins.

## The product, one sentence

Secondlayer is a self-hosted data runtime for Bitcoin and its L2s, starting
with Stacks: run it beside your node, bootstrap verified history, query
decoded data, deploy TypeScript subgraphs. We operate a signed canonical
archive on R2 and a hosted API at api.secondlayer.tools for Index and
Streams. Subgraphs and webhooks run on self-host only; we do not host them.
Prepaid credits buy archive bootstrap/backfill and hosted reads. Same
balance. Bitcoin Runes and
inscriptions are next, gated on demand (see **Bitcoin**).

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

## Brand architecture (founder-resolved 2026-09-12)

One brand: **Secondlayer**. One visual world (DESIGN.md), one accent, one
docs tree, one account. Everything on the plane is a descriptive noun inside
that brand, never a sub-brand: no per-product hue, logo, or site.

**The account test** decides what inherits the brand and what may stand
apart: if adopting a thing needs a Secondlayer account, balance, or runtime,
it inherits fully. If it is adopted by `npm install` alone and works without
us, it may carry its own identity, endorsed "by secondlayer". Only
`@secondlayer/stacks` passes. It lives at `stacks.secondlayer.tools` (the
subdomain is the lockup), on its own shell (viem-style, gold), never in a
product switcher. Own domain only if outside maintainers join or a second
account-free library ships.

Five nouns on the plane: **Archive · Streams · Index · Subgraphs · Webhooks**.
Two altitudes: primitives (Archive, Streams, Index) and opinionated products
(Subgraphs = pull, a table you own; Webhooks = push, a signed POST to a URL
you run). Product identity budget is one mono tag and one verb; each product
has its own job, not its own world. Product pages are paths under
`secondlayer.tools`, never subdomains. "Labs" is a GitHub org and legal
entity only; it prints nowhere. Scenario study and rationale: PRODUCT.md, Brand Commitments.

**Deployments** (grant-funded and one-off work, added 2026-09-13). Things we
run on the plane for a third party or as a public good, such as the sBTC
inclusion check in the Q3 2026 Endowment application, are a fourth tier:
not products, not features, not channels. A deployment is built with the
products (a subgraph table, webhook alerts, a status page), so it fails the
account test and inherits the brand. Rules: named by its job ("sBTC inclusion
check"), never a product noun or a sub-brand; lives at a path under
`secondlayer.tools`; carries one mono tag ("public good", "grant-funded") and
a "built on Subgraphs and Webhooks" line; its verifier is open source and
runnable on the operator's own instance; its hosted table is a
`visibility: public` subgraph under our account. This is the protocol-catalog
exception below, applied one deployment at a time; it is not a public
Explore catalog. Paid follow-ons (paged alerts, private destinations, SLA)
go through the Enterprise custom door, never a SKU. Deployments are evidence
for the brand, the same way our own instance is. Placement decision and
per-deployment checklist: `docs/internal/deployments.md`.

## Products

Everything we market is one of the nouns below. Everything else is a feature
of them. Archive is the history primitive (signed canonical archive; verify,
repair, bootstrap; the only line billed today). It is a noun on the plane and
a step in the golden path, same as Streams.

**Index** — decoded chain data on your instance. Query events, transfers,
blocks, transactions over REST with a cursor envelope — or build your own app
index on the same rows: a checkpointed `consume()` loop with automatic cursor
rewind on reorg (`onReorg` rolls back your own rows), `walk()` sweeps,
`from_height=0` backfill, `/canonical`, `secondlayer codegen index` for your mirror
schema. Built on Streams (our decoder is a Streams consumer). App index
without writing decoders. Boot-contract tables (pox-5, sBTC, stacking) are
the same primitive on contracts everyone shares, not a catalog. New protocols
go in the operator's `consume()` loop or a subgraph.

**Decoder tiers** (founder-resolved 2026-09-22). Generic decoding is always
hosted. It powers hosted Index, and Index-backed subgraphs
(`SUBGRAPH_SOURCE=streams-index`) and webhook chain triggers on self-host,
so it never retires. The test: if reading it
needs only the base standard (one format for every instance, no app rules),
it is Index. If it needs one app's or community's rules on top, it is a
protocol decoder, and it earns its place with a tight L2 reason or a named
customer. Today's protocol decoders: sBTC, pox-5 (BNS and pox-4 stay, do not
grow; pox-4 is off in hosted). Archive stays raw-only; decoded data is always
re-derivable from it.

**Subgraphs** — your schema. `defineSubgraph()` in one TypeScript file →
deploy → Postgres tables behind the same `/v1` read API. Self-host only.
Hosted subgraphs are not offered: the accountless hosted path ran
anonymous handler code beside prod credentials and was removed
2026-09-23. We do not host a public Explore catalog either.

**Streams** — the raw signed event firehose + parquet dumps. The inputs, not our
decoding: cursor-paginated REST, SSE tail, signed manifests, replay from any
height. For data/infra engineers building their own indexer or ETL. Also the
internal data plane the decoders and subgraphs ride.

**Webhooks** — a signed POST to a URL you run, on any subgraph table or raw
chain event. The push product, the pull product's twin. The row you register
is still a *subscription* internally (product noun Webhooks, object
subscription, the Stripe/Alchemy shape). Renamed from "Subscriptions"
2026-09-12: that word collides with "not a monthly service" and every
comparable product says Webhooks. Public rename with aliases:
`plans/rename-webhooks.md`. Self-host only: the operator's instance runs the
matcher and the sender; they host the receiver. Hosted delivery is not
offered.

**Archive** — the signed canonical history Index and Streams bootstrap from.
`secondlayer verify`, `repair`, `bootstrap`. Free against public manifests;
official-archive bootstrap and backfill are the billed lines.

### Features (not products)

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
machine or on ours. We sell archive bootstrap and hosted usage (Index/Streams
reads, subgraphs, webhook deliveries) off one prepaid balance.

One line for docs: *Reading decoded data? Index. Building your own app index on
decoded rows? Also Index — walk + cursors + reorgs[]. Your schema on your
instance? Subgraphs. Raw inputs? Streams. A POST when it happens? Webhooks.
Verified history? Archive.*

## Bitcoin (planned, gated 2026-09-22)

Same runtime, same five nouns, a second chain. No new product noun, no
sub-brand. Why now: the largest neutral provider shut down its Ordinals,
Runes and BRC-20 APIs on 2026-03-09 and pointed users at a wallet company's
API, leaving its open-source indexers orphaned. Nobody else offers an open,
self-hostable, parity-verified runtime covering Stacks and Bitcoin.

| Tier | Stacks | Bitcoin |
|---|---|---|
| Streams (raw) | blocks, txs, events | blocks, txs |
| Index (generic decode) | ft / nft / stx / print | Runes, inscriptions (metadata) |
| Protocol decoders | sBTC, pox-5 | none yet |

- **Runes first, inscriptions second.** Both have one standard and one
  reference implementation (`ord`), so both are Index, the Bitcoin
  equivalents of `ft_transfer` and `nft_mint`.
- **Parity is the product.** `ord` runs beside our indexer as a reference;
  we continuously digest-compare and publish the result. The verified-history
  wedge, applied to a second chain.
- **Out of scope:** L1 address/UTXO/balance indexing (multi-TB, served free
  elsewhere), EVM "Bitcoin L2s", inscription content serving (legal risk;
  metadata only until a takedown process exists).
- **Protocol decoders, noted and deferred** until a named customer asks:
  BRC-20 (rules disputed, needs versioned rulesets), sats names and Bitmap,
  Alkanes, marketplace sales, rare sats, collections.
- **Gate:** Phase 0 measures `ord` index size and sync time on our node and
  counts real demand. No Runes build before that count.

Brief: https://claude.ai/artifact/DsN9iEsNpFuVhX3jr27Zoq
Roadmap, decision log, gates, hosting: `docs/internal/bitcoin-runtime.md`.

## The golden path

`docker compose up` → `secondlayer bootstrap` from the official archive →
`secondlayer subgraphs create` → deploy → curl your table on localhost → attach a
webhook. Forward-only from your own node is free and skips bootstrap.

Hosted: Index and Streams reads on api.secondlayer.tools with an account
key. Subgraphs and webhooks are not hosted; run them on your instance.

## Pricing

A data pipeline, priced by rows delivered — not a query service. Not a
monthly service. The runtime is MIT. We run the archive and a hosted API.
One prepaid `account_credits` balance, denominated in dollars, meters every
hosted unit through one ledger (`usage_ledger` + `meter()`). No Pro SKU. No
retention ladder. Enterprise is a custom door.

Contract and prices live in `docs/internal/economics-metered-model.md`
(founder-resolved 2026-09-11, allowance 2026-09-24). Summary:

| Billable | Not billable |
| --- | --- |
| Official-archive bootstrap (genesis or a large range) | Self-host runtime, compose, CLI |
| Data-avail backfill / reindex that reads our archive | Forward-only indexing from the operator's node |
| Hosted Index / Streams reads past the monthly allowance | Self-host `/v1` reads |
| | The first 10M rows delivered per account per month |
| | `secondlayer verify` / `secondlayer repair` against public manifests |
| | Self-host subgraphs and webhooks |

Display unit is dollars. Charge archive bytes at fetch time with a gated
URL. Charge hosted reads after the page is served, live or history, at the
same rate — the archive is the only bulk discount. A free monthly
allowance of rows replaces the old free-height window; hosted `/v1`
without a key is 401.

We do not host subgraphs, webhook delivery, or a public Explore catalog.
Do not reintroduce monthly-plan UX.

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
- **Frozen periphery** — shipped-but-unused surfaces (multi-ORM codegen,
  aggregates, proofs, stacks-SDK wallet half (except supported nonce
  coordination)) stay shipped, lose docs prominence, and get zero further
  investment. Delete on first maintenance touch.
- **Demand before supply** — features unfreeze on a named external request, not
  on taxonomy or completeness arguments.
- **GTM is founder-led** — the prospect universe is ~30-80 funded Stacks teams.
  Templates of *their* contracts, run on their instance, are the outbound asset.
  Bitcoin adds builders stranded by the 2026-03 L1 API shutdown, once the
  Phase 0 count says they exist.

## Team & infra reality

1-2 people. Two Hetzner boxes: node-server (stacks-node, bitcoind full +
txindex, spare cores) and app-server (Postgres, API, decoders; disk is the
constraint for new chain data). Docker compose, push-to-main deploys. Every product noun costs a which-door decision for every user and a
parity tax on us; the default answer to new surface area is no.
