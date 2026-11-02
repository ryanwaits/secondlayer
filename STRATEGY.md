# Secondlayer Strategy

> What we build and why. Supersedes the former VISION / PRODUCTS / ROADMAP /
> ARCHITECTURE docs (deleted 2026-06-11; see git history). Shipped work wins: if
> this file or any other doc contradicts what shipped, fix the doc.

## The product, one sentence

Secondlayer is instant data for apps on Bitcoin, with proof included: hosted
Index, Streams, Subgraphs and chain webhooks at api.secondlayer.tools for
Stacks and Runes. Each hosted account gets its own gatewayed stack; subgraphs
there are private (no public catalog). The runtime is MIT, so the same product
also runs on your own box: run it beside your node, bootstrap history from our
signed archive on R2, deploy the same TypeScript subgraphs. Prepaid credits buy
hosted usage and archive bootstrap/backfill. Same balance. Inscriptions are
next, gated on demand (see **Bitcoin**).

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

**Public lines:** the home page leads "Instant data for apps on Bitcoin. Proof
included."; the verify story is "Trust, and verify." The primary call to action
is "Start free". Self-host is a door, never the lead.

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
us, it may carry its own identity, endorsed "by secondlayer".
`@secondlayer/stacks` passes and does. It lives at `stacks.secondlayer.tools`
(the subdomain is the lockup), on its own shell (viem-style, gold), never in a
product switcher. Own domain only if outside maintainers join.
`@secondlayer/verify` also passes (no account or key) but stays in the main
brand at `/docs/verification`: checking us is the product's claim, not a
separate library's.

**Named exception: Sentinel** (founder-resolved 2026-09-29; billing split
2026-10-19). Sentinel, security monitoring for Stacks contracts, is a separate
product sold to a different buyer (protocol teams), built on the plane. It
fails the account test on purpose: every Sentinel user has a Secondlayer
account underneath, and identity is shared (sign-in, account, agent keys). It
keeps its own identity (name, mark, `runsentinel.app`, its own sign-in and
console) and carries a "Powered by secondlayer" endorsement, never a
sub-brand of this site. Money is Sentinel's own: it bills on its own Stripe
subscriptions in the shared Stripe account, objects tagged
`metadata.product = "sentinel"`, which this site's Stripe webhook ignores. It
does not use the prepaid balance, and the platform meters no `sentinel.*`
units (retired; history rows only). Sentinel calls the platform only through
a dedicated internal service key limited to account resolve and link, token
resolve and agent keys. This is one named exception, not a pattern: any
other product that wants the same needs its own founder decision recorded
here.

Five nouns on the plane: **Archive · Streams · Index · Subgraphs · Webhooks**.
Two altitudes: primitives (Archive, Streams, Index) and opinionated products
(Subgraphs = pull, a table you own; Webhooks = push, a signed POST to a URL
you run, on a chain event). Product identity budget is one mono tag and one verb; each product
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
runnable on the operator's own instance; its hosted table is a subgraph under
our account. Subgraphs have no public visibility (dropped, migration 0136) and
hosted `/v1` needs a key, so a deployment's public page needs its own read
path, decided per deployment. The sBTC inclusion check has no page yet. Paid
follow-ons (paged alerts, private destinations, SLA) are a per-deployment
conversation, never a SKU. Deployments are evidence for the brand, the same way
our own instance is. Placement decision and per-deployment checklist:
`docs/internal/deployments.md`.

## Products

Everything we market is one of the nouns below. Everything else is a feature
of them. Archive is the history primitive (signed canonical archive; verify,
repair, bootstrap; billed per fetch). It is a noun on the plane and
a step in the golden path, same as Streams.

**Index** — decoded chain data, hosted or on your instance. Query events, transfers,
blocks, transactions over REST with a cursor envelope — or build your own app
index on the same rows: a checkpointed `consume()` loop with automatic cursor
rewind on reorg (`onReorg` rolls back your own rows), `walk()` sweeps,
`from_height=0` backfill, `/canonical`, `secondlayer codegen index` for your mirror
schema. Built on Streams (our classic decoders read Streams' own reader
in-process; protocol decoders are still Streams consumers over HTTP). App index
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
deploy → Postgres tables behind the same `/v1` read API. Hosted and private
(live since 2026-10-06): one isolated stack per account, handler code in a
gVisor sandbox with no network beyond our API and the public internet. Or
self-host. The accountless hosted path ran anonymous handler code beside prod
credentials and was removed 2026-09-23; it does not come back. No public
Explore catalog, no fork, no marketplace.

**Streams** — the raw signed event firehose + parquet dumps. The inputs, not our
decoding: cursor-paginated REST, SSE tail, signed manifests, replay from any
height. For data/infra engineers building their own indexer or ETL. Also the
internal data plane the decoders and subgraphs ride.

**Webhooks** — a signed POST to a URL you run, on a chain event you named.
The push product, the pull product's twin. Subgraph-row webhooks were removed
2026-10-12: subgraph rows are pulled, by a trigger on your own Postgres or a
cursor poll. The row you register is still a *subscription* internally (product
noun Webhooks, object subscription, the Stripe/Alchemy shape). Renamed from
"Subscriptions" 2026-09-12: that word collides with "not a monthly service" and
every comparable product says Webhooks. Hosted: an `sk-sl_*` key and prepaid
credits; the gateway resolves the key to that account's own tenant stack (one
self-host stack per account, unchanged runtime) and never forwards the customer
key into it. Hosted caps: `max_retries` ≤ 7, `timeout_ms` ≤ 30000. Self-host:
the operator's instance runs the matcher and the sender, they host the receiver,
and they set the caps (defaults 100 and 300000).

**Archive** — the signed canonical history Index and Streams bootstrap from.
`secondlayer verify`, `repair`, `bootstrap`. `verify` is free against public
manifests. Official-archive bootstrap and backfill are billed; `repair` gets 24
free partitions a month, then bills.

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
  not response-signed yet (deferred). The counterpart to "build
  your own" — replay and check us. Proofs go further: `/v1/proofs`,
  `@secondlayer/verify` and `secondlayer verify block` walk a Stacks block from
  a shipped checkpoint through Bitcoin headers, signer signatures, the tx merkle
  root and MARF state proofs. Checking is free. Guiding principle: an index you
  can check, not one you have to trust.

### Channels (not features)

How you reach the products, never product nouns: REST + OpenAPI (the contract),
the signed-in dashboard at `/account`, CLI, SDK, MCP server (distribution for
agents; golden-path tools only).

## Index vs Streams — who uses which

This distinction is load-bearing; keep it crisp everywhere:

| | Index | Streams |
|---|---|---|
| What | Decoded chain data, kept indexed | Raw signed event firehose + dumps |
| We do | Run the chain indexer and decoder | Hand you the inputs |
| You do | Query over REST — or build your app index on the rows | Build and run your own indexer/ETL from raw |
| Who | App devs, agents, dashboards | Data/infra engineers, indexer builders |
| Verify | Prove the block your rows came from (`verify block`, `/v1/proofs`) | Signed manifests, replay from any height |

Both are indexer products at different levels: Streams is raw, low-level
indexing — Index is app-level indexing on decoded rows. Streams powers Index:
our classic decoders read Streams' own reader in-process (protocol decoders
still consume it over HTTP). Subgraphs is the Index loop, on your
machine or on ours. We sell archive bootstrap and hosted usage (Index/Streams
reads, subgraphs, webhook deliveries) off one prepaid balance.

One line for docs: *Reading decoded data? Index. Building your own app index on
decoded rows? Also Index — walk + cursors + reorgs[]. Your schema? Subgraphs.
Raw inputs? Streams. A POST when it happens? Webhooks.
Verified history? Archive.*

## Bitcoin

Same runtime, same five nouns, a second chain. No new product noun, no
sub-brand. Why now: the largest neutral provider shut down its Ordinals,
Runes and BRC-20 APIs on 2026-03-09 and pointed users at a wallet company's
API, leaving its open-source indexers orphaned. Nobody else offers an open,
self-hostable, parity-verified runtime covering Stacks and Bitcoin.

| Tier | Stacks | Bitcoin |
|---|---|---|
| Streams (raw) | blocks, txs, events | Runes events (`rune_*`); raw blocks/txs on request |
| Index (generic decode) | ft / nft / stx / print | Runes (inscription metadata next) |
| Protocol decoders | sBTC, pox-5 | none yet |

- **Runes first, inscriptions second.** Both have one standard and one
  reference implementation (`ord`), so both are Index, the Bitcoin
  equivalents of `ft_transfer` and `nft_mint`.
- **Parity is the proof.** Runes have no on-chain commitment, so `ord`, the
  reference implementation, runs beside our indexer and we compare results:
  daily spot checks plus full diffs at frozen heights. The product pages state
  the result ("checked against ord with 0 mismatches").
- **Out of scope:** L1 address/UTXO/balance indexing (multi-TB, served free
  elsewhere), EVM "Bitcoin L2s", inscription content serving (legal risk;
  metadata only until a takedown process exists).
- **Protocol decoders, noted and deferred** until a named customer asks:
  BRC-20 (rules disputed, needs versioned rulesets), sats names and Bitmap,
  Alkanes, marketplace sales, rare sats, collections.

Brief: https://claude.ai/artifact/DsN9iEsNpFuVhX3jr27Zoq
Roadmap, decision log, gates, hosting: `docs/internal/bitcoin-runtime.md`.

## The golden path

Key from `/account/keys` → install the CLI → `secondlayer subgraphs create
--from-contract` → deploy → curl your table → `secondlayer verify block` on the
block your rows came from.

Index, Streams, Subgraphs and Webhooks all run on api.secondlayer.tools with
an account key. Hosted subgraphs and webhook delivery run in a private stack
per account; there is no public catalog. Hostable subgraph sources are event
filters and contract_call/contract_deploy.

Self-host is the same product on your Postgres: `docker compose up` →
`secondlayer bootstrap` from the official archive → the same subgraph steps on
localhost → react to rows from your Postgres. Forward-only from your own node is
free and skips bootstrap.

## Pricing

A data pipeline, priced by rows delivered — not a query service. Not a
monthly service. The runtime is MIT. We run the archive and a hosted API.
One prepaid `account_credits` balance, denominated in dollars, meters every
hosted unit through one ledger (`usage_ledger` + `meter()`). No Pro SKU. No
retention ladder.

Prices live in `packages/platform/src/billing/prices.ts`; rationale in
`docs/internal/economics-metered-model.md`. Summary:

| Billable | Not billable |
| --- | --- |
| Official-archive bootstrap (genesis or a large range) | Self-host runtime, compose, CLI |
| Data-avail backfill / reindex that reads our archive | Forward-only indexing from the operator's node |
| `secondlayer repair` past 24 partitions a month | The first 24 repair partitions a month |
| Hosted Index / Streams reads past the monthly allowance | Self-host `/v1` reads |
| Hosted subgraph indexing rows past the monthly allowance | The first 1M rows delivered per account per month |
| A running hosted stack's memory, floored at $5/mo webhook-only or $10/mo with subgraphs | Block headers |
| Hosted stack storage | Reads of your own subgraph tables |
| Hosted webhook events ($10 per 1M, retries free) | |
| | `secondlayer verify` against public manifests, `verify block`, `/v1/proofs` |
| | Self-host subgraphs and webhooks |
| | A stopped hosted stack |

Display unit is dollars. Charge archive bytes at fetch time with a gated
URL. Charge hosted reads after the page is served, live or history, at the
same rate — the archive is the only bulk discount. A free monthly
allowance of rows replaces the old free-height window: past it, an
account needs balance or the read 402s before serving, with a top-up
link. Hosted `/v1` without a key is 401.

We host subgraphs and webhook delivery, private per account. There is no public subgraph or Explore catalog.
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

- **Parity firewall** — a new capability ships REST route + OpenAPI entry first.
  SDK and CLI wrappers follow where they earn their place (Runes and proofs have
  them), generated where possible; MCP stays golden-path only. Releases go out
  as changesets when ready.
- **Frozen periphery** — shipped-but-unused surfaces (index stacking/mempool
  extras, the stacks-SDK wallet half (except supported nonce coordination),
  webhooks format expansion) stay shipped, lose docs prominence, and get zero
  further investment. Being on this list is never grounds to delete; that takes
  usage or dead-code evidence.
- **Demand before supply** — features unfreeze on a named external request, not
  on taxonomy or completeness arguments.
- **GTM is founder-led** — the prospect universe is ~30-80 funded Stacks teams.
  Bitcoin adds builders stranded by the 2026-03 L1 API shutdown.

## Team & infra reality

1-2 people. Four Hetzner hosts: node-server (stacks-node, bitcoind full +
txindex), app-server (Postgres, API, decoders, Runes; disk is the constraint for
new chain data), stacks-feeder (genesis sync for the Clarity write log) and the
workload host (one stack per hosted account). Docker compose, push-to-main
deploys. Every product noun costs a which-door decision for every user and a
parity tax on us; the default answer to new surface area is no.
