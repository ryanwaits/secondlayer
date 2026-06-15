---
name: stacks-ecosystem-opportunity-scout
description: >-
  Analyze Stacks ecosystem signals and map them to high-value product, marketing, security, and
  onboarding opportunities buildable with secondlayer tools (Index, Subgraphs, Streams, CLI, SDK,
  @secondlayer/stacks, MCP). Use when the user pastes a Stacks Discord "this week in Stacks"
  announcement digest, or points at any single source — a Hiro GitHub issue, a forum/X thread, a
  dev complaint about the Hiro API or another service, a protocol launch, or a historical
  hack/exploit writeup — and wants it parsed, its links fetched and analyzed, and turned into
  ranked opportunities for product validation, developer onboarding, ecosystem/dev-need solutions,
  security tooling, or brand content. Triggers on "scout the announcements", "stacks opportunities",
  "what can we build from this", "analyze this for product opportunities", "ecosystem scan".
---

# Stacks Ecosystem Opportunity Scout

Turn raw Stacks ecosystem signals into a ranked, defensible list of opportunities tied to concrete
secondlayer capabilities. Works on a full Discord announcement digest OR any single arbitrary
source (issue, thread, exploit writeup, launch).

## Required reading before analysis

Read both before mapping anything — they are the source of truth, not background:
- `references/secondlayer-capabilities.md` — what we can actually build with. Every opportunity
  must map to a capability here, or be labeled "adjacent / not ours."
- `references/opportunity-lenses.md` — the five lenses, the signal→opportunity mapping, and the
  scoring rubric. Apply exactly.

## Workflow

### 1. Classify input
- **Digest** (multi-item, e.g. "This week in Stacks"): many signals, each a category + blurb + links.
- **Single source** (one URL, issue, thread, exploit, launch): treat as one signal; go deep.
Either way the rules are identical — only the count of signals changes.

### 2. Parse into discrete signals
Extract each item as: category, claim/blurb, named entities (projects, people), and **every URL /
reference**. Do not summarize away the links — they drive enrichment. Keep raw text for items whose
links fail to fetch.

### 3. Enrich — fetch & analyze every link
For each URL: fetch and extract what it actually is, who's behind it, the numbers ($/users/volume),
and the data/dev/security need it implies.
- **X.com / Twitter links usually block fetching.** On failure, fall back to WebSearch on the
  entity + claim, or reason from the digest blurb. Never silently drop a signal — note "link
  unfetchable, inferred from blurb."
- GitHub issues/PRs/releases, forum posts, docs, and Play Store/app pages usually fetch fine —
  pull the substantive detail (what was declined, what's requested, what shipped).

### 4. Map through the five lenses
Run every signal through all five lenses (Hiro-gap, Dev-pain, Security, Onboarding, Marketing) per
`opportunity-lenses.md`. One signal may yield several opportunities. Tie each to an exact capability
from the capabilities ref. If nothing maps, mark "adjacent / not ours" — do not invent tools.

### 5. Ground each in a business outcome
For every opportunity, name the **expected return**: who becomes a customer, what they pay (which
product/tier), and the path to get there — per `opportunity-lenses.md` → "Business outcome." Pick a
primary outcome type (direct revenue / new self-serve users / partnership-BD / enterprise-strategic /
exposure-brand). Never leave it blank; if it's exposure-only with no revenue, say that plainly.

### 6. Score & rank
Score each opportunity on Demand / Fit / Differentiation / Effort (1–5 each, per rubric). Sum,
tier into **Now (≥16) / Next (11–15) / Watch (≤10)**. On ties, prefer direct-revenue or named-
partnership plays over pure-exposure ones.

### 7. Output the report
Use this structure:

```
# Opportunity Scout — <source label> (<date>)

## TL;DR
<2–4 sentences: the single highest-value play + count of Now/Next/Watch.>

## Now  (build/ship this week)
### <Opportunity title>
- Signal: <what fired it + demand evidence>
- Lens: <which> | Capability: <exact secondlayer tool/endpoint>
- Build: <the concrete thing — subgraph/endpoint/alert/demo/post>
- Angle: product | marketing | security | onboarding
- Proof-of-value: <the one demo/number/screenshot that lands it>
- Expected return: <primary outcome — direct revenue | self-serve users | partnership/BD | enterprise | exposure> · <who the customer is + what they pay / which product tier + path to get there>
- First step: <a real `sl …` command, endpoint, or content outline>
- Score: D_/F_/Diff_/E_ = __/20

## Next
<same shape, terser>

## Watch
<one line each: signal → why it's not actionable yet>

## Signals parsed
<table: signal | links fetched? | lens(es) | mapped capability | expected return | tier>
```

Lead with the sharpest play. Prefer Hiro-gap and security opportunities — they carry the strongest
demand + differentiation. Always give at least the top 3 a concrete first step and a concrete
expected return.

## Notes
- Be honest about effort and fit; a padded list is worse than three sharp plays.
- This skill identifies and ranks opportunities. It does not build them — when the user picks one,
  hand off to normal subgraph/CLI/content workflows.
- For heavy digests (many links), the analysis parallelizes well: parse once, fan out enrichment
  per link, then synthesize. Orchestrate with a workflow when link count is high.
