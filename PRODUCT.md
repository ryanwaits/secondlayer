# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: a funded Stacks app team (roughly 2–8 people) whose contract is live and whose product screens need data no general API will ever have: positions, deposits, pool share, settlement state.

Secondary: a data/infra engineer who wants the signed raw or decoded plane so they can build their own indexer, subgraph runtime, or webhook sender. They may compete with our out-of-the-box products. They still pay for the plane.

Planned (gated on Phase 0 demand, 2026-09-22): a Bitcoin app team (wallet, marketplace, launchpad, portfolio tool) that needs Runes balances and inscription ownership, hosted or on their own node, and lost its neutral provider when the largest one shut down its L1 APIs in 2026-03.

Tertiary: a TypeScript engineer who wants a typed Stacks client (`@secondlayer/stacks`). They are a package audience, not the first marketing door.

## Product Purpose

Secondlayer is one account that sells chain data for Bitcoin and its L2s at two altitudes. Stacks today. Bitcoin Runes and inscriptions next, as Index data on the same plane (STRATEGY.md, Bitcoin).

**Index and Streams** are the metered primitives. Index is decoded rows (Stacks events today; Runes and inscriptions once shipped). Streams is the signed raw firehose and dumps. An operator can self-host the runtime beside a node, or consume the primitives from us. Either way, this is the atomic layer: enough to build your own subgraphs, your own webhooks, or anything else. We still charge for that usage. SDK and tooling exist so someone can compete with our opinionated products and remain a customer.

**Subgraphs** is a product on that plane: one TypeScript file becomes a schema, tables, and a REST API. We fill it from Index/Streams. Self-host only: it runs on their instance, and we do not host subgraphs.

**Webhooks** is a product on that plane: they register a filter and a URL they run; their instance matches, signs, retries, and POSTs to that URL. Self-host only: we do not host delivery. They host the receiver. The registered row is a *subscription* internally; the product noun is Webhooks.

**Archive** is the history primitive under both: the signed canonical archive that Index and Streams bootstrap from. Verify, repair, bootstrap. The only line billed today.

Success is a team querying their own contract's data, or receiving signed POSTs for it, without writing an indexer, and paying for the plane work that made it true. A team that skips Subgraphs and Webhooks and builds their own on Index/Streams is also success.

## Positioning

One Secondlayer account. One brand. Five nouns on one plane. Different jobs.

Brand architecture (founder-resolved 2026-09-12, scenario C of the positioning study): platform plus one endorsed library. Presentation analogue: Vercel / Next.js and Prisma ORM / Pulse. The platform is a branded house (Alchemy, Goldsky shape): descriptive nouns, one world. The library stands apart because it is adopted without us. Not a studio portfolio. Not a homepage that lists five nouns; the nouns are answers to one fork, not a menu.

The Grok / Grok Build / Grok CLI analogue is retired. Those differ in modality (chat, IDE, terminal); Subgraphs and Webhooks share one CLI, one TypeScript file, and one balance, so a second visual world there is cost a reader cannot feel.

Organizational analogue (not visual): Fungible Systems, a small Stacks-era group that shipped libraries (micro-stacks), wallet infra, and product work under one shop. We ship libraries and infra the same way. We do not copy that site's look.

The claim a neighbor cannot copy: the out-of-the-box products and the primitives they are built on are the same metered plane. Fork or compete at the atomic layer; you still pay us for Index/Streams.

## Operating Context

- OSS self-host path: `secondlayer setup` beside a node, archive bootstrap, subgraph deploy, subscription against their instance.
- Hosted path: archive plus keyed Index/Streams reads. Hosted subgraphs and webhooks are not offered (accountless play and hosted meters removed 2026-09-23).
- Meter: archive bootstrap/backfill today; usage of Index/Streams primitives is the intended charge. SKUs are the meters in `docs/internal/economics-metered-model.md` (founder-resolved 2026-09-11).
- Golden path for an app team: scaffold their contract → table they query → optional webhook to a URL they own.
- Docs, CLI, SDK, MCP are channels, not products.
- `@secondlayer/stacks` is a viem-style chain client in the same org. It is the one thing adopted without a runtime or account, so it is the one thing with its own home: `stacks.secondlayer.tools`. Wallet half frozen except nonce coordination.

## Capabilities and Constraints

Confirmed:

- Archive, Index, Streams, Subgraphs, Webhooks already exist in the runtime. Webhooks still answers to `subscriptions` in the API, CLI, SDK, MCP and docs until `plans/rename-webhooks.md` lands.
- We do not host their webhook endpoint. We send to it.
- Same payload shapes on hosted and self-host so a team can fork later.
- OSS loopback `/v1` reads are keyless; hosted `/v1` is keyed (`Authorization: Bearer`, account key `sk-sl_*`). Keys gate hosted reads and all writes.
- Voice: calm infrastructure. No exclamation points, no emoji, no hype, no competitor naming in public copy.
- Hosted decoded reads stay. Generic decoders power hosted Index, and self-hosted Subgraphs and webhook triggers. Protocol decoders (sBTC, pox-5 today) earn their place; on Bitcoin, BRC-20, sats names, Alkanes and similar are noted and deferred until a customer asks.
- Bitcoin scope excludes L1 address/UTXO indexing and inscription content serving. `ord` is the parity reference for Runes and inscriptions.
- Team is 1–2 people. Two Hetzner boxes today (node-server with stacks-node and bitcoind, app-server). Every product noun is a door and a parity tax; the family is five nouns, not a junk drawer.
- We do not host a public Explore catalog of other people's subgraphs unless a later grant explicitly funds a protocol catalog (sBTC, PoX, BNS) as a public good.

Resolved 2026-09-12 (was open):

- Product URLs: paths under `secondlayer.tools` (`/subgraphs`, `/webhooks`). Subdomains would imply separate worlds. The one subdomain is `stacks.secondlayer.tools`, because the library is the one thing that stands apart.
- "Labs" never prints. GitHub org and legal entity only. Revisit only if an outside venture needs a parent that is not the platform's name.
- `@secondlayer/stacks` is not in any product switcher. A footer link from the platform is enough.

## Brand Commitments

- Company, account, brand, npm scope: Secondlayer. One wordmark, the only logo.
- **The account test** (binding): needs a Secondlayer account, balance, or runtime → inherits the brand fully. Adopted by `npm install` alone and works without us → may carry its own identity, endorsed "by secondlayer". Only `@secondlayer/stacks` passes today.
- Product nouns: **Archive · Streams · Index · Subgraphs · Webhooks**. Descriptive, capitalised as proper names in product copy, never with their own logo or hue. Identity budget per product: one mono tag and one verb (Archive verifies, Streams hands you, Index decodes, Subgraphs fills, Webhooks delivers).
- Subgraphs stays Subgraphs. It is a category noun now, it implies the right category, and "Views" collides with SQL views. Subscriptions became Webhooks (pricing collision; every comparable product says Webhooks). One rename, not three.
- Naming tiers: Parent (Secondlayer) → Product (noun) → Package (`@secondlayer/*`, provenance not brand) → Command (`secondlayer <noun>`).
- Deployments (grant-funded, one-off, public goods such as the sBTC inclusion check): a fourth tier. Built with the products, so they inherit the brand. Named by job, path under `secondlayer.tools`, one mono tag, "built on Subgraphs and Webhooks" line, open-source verifier, public-visibility subgraph under our account. Never a sub-brand, never a product noun, never a catalog. See STRATEGY.md "Deployments".
- One visual world for everything on the plane: DESIGN.md (Sora, ink-on-paper, terminal as the product stage, sunset accent). Products have their own job, not their own world.
- The library's world: `stacks.secondlayer.tools`, viem-style shell, egg-white / gold, wordmark "stacks · by secondlayer". Endorsement in wordmark and footer, never a second Secondlayer hero.
- Homepage: jobs-first hero, then one fork the reader can answer about themselves (need rows to query, or already have an API layer). Subgraphs and Webhooks are the two answers. Archive, Index, Streams appear once, in a footer band, as what the answers are built on.
- Fungible Systems (https://fungible.systems/) is an organizational analogue only. Do not copy script wordmark, iridescent NFT case-study hero, or 2021 web3 studio gloss.
- Presentation analogues: Vercel / Next.js, Prisma ORM / Pulse (platform plus endorsed library); Alchemy, Goldsky (descriptive nouns inside one brand). Grok / Grok Build / Grok CLI is retired.
- No "vs Hiro" in public.

## Evidence on Hand

- Runtime, CLI, SDK, MCP, docs, two writing posts, archive meter page.
- Homepage currently sells the agent skill and a generic `sbtc-flows` table, not the family.
- No named customer case. Do not invent logos, quotes, query volumes, or team names.
- Fungible Systems screenshots for org-analogue reference only: `.impeccable/refs/fungible/`.
- Demonstration data in mocks may be synthetic and must be labeled if a visitor could take it as live.

## Product Principles

1. One account, one brand, five nouns, two altitudes (primitives vs opinionated).
2. The opinionated products are powered by the primitives; the primitives are for sale even to people who will compete with the opinionated products.
3. We send. They receive. We never imply we host their webhook URL.
4. Each product has its own job, in one world. Subgraphs is a table you own. Webhooks is a signed POST leaving the building. The job shows in the copy, the verb and the terminal demo, never in a second palette.
5. A new chain is more data on the same plane, never a new noun or a new world.
6. Do not make the reader pick a door until they already know which job they have. The switcher is for people who already have an account, not a homepage menu of architecture nouns.
