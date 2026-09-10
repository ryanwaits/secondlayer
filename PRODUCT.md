# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: a funded Stacks app team (roughly 2–8 people) whose contract is live and whose product screens need data no general API will ever have: positions, deposits, pool share, settlement state.

Secondary: a data/infra engineer who wants the signed raw or decoded plane so they can build their own indexer, subgraph runtime, or webhook sender. They may compete with our out-of-the-box products. They still pay for the plane.

Tertiary: a TypeScript engineer who wants a typed Stacks client (`@secondlayer/stacks`). They are a package audience, not the first marketing door.

## Product Purpose

Secondlayer is one account that sells Stacks chain data at two altitudes.

**Index and Streams** are the metered primitives. Index is decoded rows. Streams is the signed raw firehose and dumps. An operator can self-host the runtime beside a node, or consume the primitives from us. Either way, this is the atomic layer: enough to build your own subgraphs, your own subscriptions, or anything else. We still charge for that usage. SDK and tooling exist so someone can compete with our opinionated products and remain a customer.

**Subgraphs** is a product on that plane: one TypeScript file becomes a schema, tables, and a REST API. We fill it from Index/Streams. Hosted or on their instance.

**Subscriptions** is a product on that plane: they register a filter and a URL they run; we match, sign, retry, and POST to that URL. We host the matcher and the sender. They host the receiver.

Success is a team querying their own contract's data, or receiving signed POSTs for it, without writing an indexer, and paying for the plane work that made it true. A team that skips Subgraphs and Subscriptions and builds their own on Index/Streams is also success.

## Positioning

One Secondlayer account. Three products. Same plane. Different jobs.

Presentation analogue (binding): Grok vs Grok Build vs Grok CLI. Related, aesthetically different, different products, one account. Not a studio portfolio. Not a single runtime page that lists four nouns.

Organizational analogue (not visual): Fungible Systems, a small Stacks-era group that shipped libraries (micro-stacks), wallet infra, and product work under one shop. We ship libraries and infra the same way. We do not copy that site's look.

The claim a neighbor cannot copy: the out-of-the-box products and the primitives they are built on are the same metered plane. Fork or compete at the atomic layer; you still pay us for Index/Streams.

## Operating Context

- OSS self-host path: `secondlayer setup` beside a node, archive bootstrap, subgraph deploy, subscription against their instance.
- Hosted path (strategy change, founder-approved in this thread): register subgraphs and subscriptions on our infra; they still run the webhook receiver.
- Meter: archive bootstrap/backfill today; usage of Index/Streams primitives, and of hosted Subgraphs/Subscriptions, is the intended charge. Exact SKUs are open.
- Golden path for an app team: scaffold their contract → table they query → optional webhook to a URL they own.
- Docs, CLI, SDK, MCP are channels, not products.
- `@secondlayer/stacks` is a viem-style chain client in the same org. Wallet half frozen except nonce coordination.

## Capabilities and Constraints

Confirmed:

- Index, Streams, Subgraphs, Subscriptions already exist in the runtime.
- We do not host their webhook endpoint. We send to it.
- Same payload shapes on hosted and self-host so a team can fork later.
- Reads on `/v1` are keyless in beta; keys gate writes.
- Voice: calm infrastructure. No exclamation points, no emoji, no hype, no competitor naming in public copy.
- Team is 1–2 people. One Hetzner box today. Every product noun is a door and a parity tax; the family is three products, not a junk drawer.
- We do not host a public Explore catalog of other people's subgraphs unless a later grant explicitly funds a protocol catalog (sBTC, PoX, BNS) as a public good.

Open:

- Hosted Subgraphs and hosted Subscriptions as billed products (this conversation). STRATEGY.md still says we do not host subgraphs and we sell archive bytes, not compute. Founder is rewriting that. Public copy must not ship until STRATEGY.md matches.
- Product URLs: subdomains vs paths vs separate domains.
- Whether "Labs" ever prints. Default: no. The account is Secondlayer.
- Whether `@secondlayer/stacks` appears in the product switcher or stays a docs/npm package.
- Grant vs usage-meter mix for hosted.

## Brand Commitments

- Company and account name: Secondlayer.
- Product names, for now: **Index / Streams** (the plane), **Subgraphs**, **Subscriptions**. Working names, not a rename exercise.
- `secondlayer.tools` is the plane: self-host, archive, docs, primitives. Its current visual world (Sora, ink-on-paper, terminal as the product stage, DESIGN.md) stays on that surface. Do not recolor it into the new products.
- Subgraphs and Subscriptions each get their own visual world. Not a recolor of the plane. Not a recolor of each other. Shared account chrome (switcher, lockup) is the only overlap.
- Lockup on the opinionated products: "Powered by Secondlayer" in the footer, never a second hero.
- Fungible Systems (https://fungible.systems/) is an organizational analogue only. Do not copy script wordmark, iridescent NFT case-study hero, or 2021 web3 studio gloss.
- Grok / Grok Build / Grok CLI is the presentation analogue: same account, different strokes.
- No "vs Hiro" in public. No Labs-as-parent-brand unless the founder prints it on purpose.

## Evidence on Hand

- Runtime, CLI, SDK, MCP, docs, two writing posts, archive meter page.
- Homepage currently sells the agent skill and a generic `sbtc-flows` table, not the family.
- No named customer case. Do not invent logos, quotes, query volumes, or team names.
- Fungible Systems screenshots for org-analogue reference only: `.impeccable/refs/fungible/`.
- Demonstration data in mocks may be synthetic and must be labeled if a visitor could take it as live.

## Product Principles

1. One account, three products, two altitudes (primitives vs opinionated).
2. The opinionated products are powered by the primitives; the primitives are for sale even to people who will compete with the opinionated products.
3. We send. They receive. We never imply we host their webhook URL.
4. Each product looks like its job. The plane looks like infra. Subgraphs looks like a table you own. Subscriptions looks like a signed POST leaving the building.
5. Do not make the reader pick a door until they already know which job they have. The switcher is for people who already have an account, not a homepage menu of architecture nouns.
