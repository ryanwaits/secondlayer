# Opportunity Lenses & Scoring

How to turn a raw signal into a ranked, defensible opportunity. Apply every lens to every signal,
then score. Read this fully before mapping.

## Table of contents
- The five lenses
- Signal → opportunity mapping
- Business outcome — what we expect to get
- Scoring rubric
- Worked examples
- Anti-patterns (reject these)

## The five lenses

Run each signal through all five. One signal can yield multiple opportunities under different lenses.

1. **Hiro-gap** — Does this expose something Hiro's API can't / won't do, or a dev frustrated with
   it? Highest-value lens: proven demand + built-in differentiation. See `secondlayer-capabilities.md`
   → "The Hiro gap." Output: a decoded endpoint / subgraph / dataset that fills the gap.
2. **Dev-pain** — Does a dev/team need data, decoding, indexing, or webhooks they're hand-rolling?
   (forum threads, GitHub issues, "how do I get X" questions). Output: a subgraph template, SDK
   recipe, or `sl` quickstart that erases the pain.
3. **Security / exploit-prevention** — Is this a hack, exploit, drained contract, rug, or risky
   pattern? Output: a detection subgraph / webhook alert / monitoring recipe built on our events
   (e.g. watch `print_event` + `ft_transfer` anomalies, sBTC peg irregularities, large transfers).
   Bespoke security tooling doubles as brand-building proof-of-value content.
4. **Onboarding / proof-of-value** — Is there a hot protocol, new launch, or trending contract we
   can index live to show "look how fast secondlayer ships a working view"? Output: a public
   subgraph in Explore, a demo dashboard, a tutorial, a one-command quickstart.
5. **Marketing / narrative** — Does this map to a story that positions secondlayer (Bitcoin-native
   data, decoded-where-others-won't, agent-native via MCP/x402, verifiable delivery)? Output: a
   blog post, thread, comparison, or launch tie-in. Must still anchor to a real capability.

## Signal → opportunity mapping

For each enriched signal capture:
- **Signal**: what it is, who's behind it, what it implies (1–2 lines).
- **Demand evidence**: volume/$/users/engagement/explicit complaint that proves people care.
- **Lens(es)**: which of the five fire.
- **Capability**: the exact secondlayer tool/endpoint/package it maps to (from capabilities ref).
- **Opportunity**: the concrete thing to build/write (a subgraph, endpoint, alert, demo, post).
- **Angle**: product | marketing | security | onboarding (can be several).
- **Proof-of-value**: the one demo/number/screenshot that would make it land.
- **Expected return**: the tangible business outcome — who becomes a customer, what they pay
  (which product/tier), and the path to get there. Forces "why is this worth our time?" See
  "Business outcome" below. Never leave blank; if the honest answer is "exposure only, no direct
  revenue," say exactly that.

## Business outcome — what we expect to get

Every opportunity costs us time; each must name what it returns. Pick the **primary** outcome (one
opp can have a secondary too), and state the customer + monetization path concretely — not
"more users" but "self-serve app dev deploys a paid Pro subgraph."

Outcome types:
- **Direct revenue** — someone pays for usage. The goal. Tie to a paid surface (below).
- **New self-serve users** — signups into the funnel (keyless Index / free tier) that convert later.
  Tangible only if you name the conversion step (free read → Pro subgraph).
- **Partnership / BD** — a protocol *team* becomes the customer/integration; can mean recurring
  account revenue and a logo. Higher ceiling, slower close, needs an outbound motion (who we DM).
- **Enterprise / strategic** — we become load-bearing infra for a protocol (their app, their AI
  copilot, their alerts run on us). Largest recurring contracts; treat as a named BD target.
- **Exposure / brand** — content/proof-of-value that feeds the funnel indirectly. Real but weakest;
  only count it as the primary outcome when the play is genuinely a post/demo, and say so plainly.

Monetization map — which capability actually bills (from `secondlayer-capabilities.md`):
- **Subgraphs** — the revenue core (paid tiers; genesis backfill is Pro). Most "direct revenue" and
  "enterprise" plays route here.
- **Streams** — Build+ tier (paid bearer token). Data/infra-engineer revenue.
- **x402** — pay-per-call (sBTC/USDCx/STX), agent-native, no signup. Revenue from agent/copilot traffic.
- **Index (keyless)** — free; **top-of-funnel**, not direct revenue. Drives signups + exposure, then
  upsell to Subgraphs/Streams. A keyless-only play is a funnel/exposure play, not a revenue play.
- **CLI / SDK / @secondlayer/stacks / MCP** — adoption surfaces, not directly billed; they widen the
  funnel and unlock partnership/enterprise integrations (MCP+x402 is the agent-revenue wedge).

Be honest about timeline: self-serve revenue is fast and small; partnership/enterprise is slow and
large. When two opportunities tie on score, prefer the one with a **direct revenue or named
partnership** path over a pure-exposure play.

## Scoring rubric

Score each opportunity 1–5 on four axes, sum (max 20), then rank.

- **Demand** (1–5): real, evidenced pull (users/$/complaints) vs speculative.
- **Fit** (1–5): how cleanly it maps to an existing secondlayer capability (5 = ships today with
  current tools; 1 = needs new infra we don't have).
- **Differentiation** (1–5): Hiro-gap or unique-to-us = 5; commodity anyone could do = 1.
- **Effort** (1–5, inverted): 5 = hours (subgraph/demo/post); 1 = weeks of new infra.

Tier by total: **Now** (≥16), **Next** (11–15), **Watch** (≤10). Always surface at least the top
3 "Now"/"Next" with a concrete first step (`sl …` command, endpoint, or content outline).

## Worked examples

- **Decoded sBTC flows (the canonical win)**: Hiro declined to expose decoded sBTC peg
  lifecycle in a GitHub issue. Lens: Hiro-gap. Capability: `/v1/index/sbtc/*` + finality gating.
  Opportunity: typed keyless sBTC deposit/withdrawal feed + "Hiro said no, we shipped it" post.
  Score: Demand 5 / Fit 5 / Diff 5 / Effort 5 = 20 → Now.
- **New DeFi pool launch (e.g. an AMM/HODLMM pool)**: Lens: onboarding + dev-pain. Capability:
  Subgraphs + `sl subgraphs scaffold`. Opportunity: public subgraph indexing the pool's swaps/LP
  events + demo dashboard in Explore; tutorial "index any new pool in 5 min." Diff: medium (we're
  faster/node-free). 
- **Reported exploit / drained contract**: Lens: security. Capability: Index `print_event` +
  `ft_transfer` + subscriptions/webhooks. Opportunity: a "drain detector" subgraph + signed webhook
  alert recipe; writeup "how this attack would've been caught in real time." Brand + onboarding.
- **A new tooling release (e.g. Clarinet)**: Lens: marketing/dev-pain. Capability: `@secondlayer/cli`
  codegen + `@secondlayer/stacks`. Opportunity: integration guide / interop content; watch for
  feature overlap. Usually Watch/Next unless it exposes a data gap.

## Anti-patterns (reject these)

- Inventing a capability we don't have to fit a shiny signal. If no capability maps, label
  "adjacent / not ours" and move on.
- Pure price/token-pump news with no data, dev, or security hook.
- Vague "we could make content about this" with no anchored capability or demo.
- Generic dashboards a dozen tools already ship (low differentiation) unless there's a Hiro gap.
