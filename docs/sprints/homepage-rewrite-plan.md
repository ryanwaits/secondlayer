# Homepage Rewrite — Implementation Plan

Source of truth: `docs/mocks/home-v2.html` (signed-off mock). Hard constraints: existing fonts via `next/font` vars only (`--font-{heading,sans,mono,cursive}`), existing tokens in `globals.css`, reuse platform components everywhere they exist, zero layout shift in demo panes, `prefers-reduced-motion` = static.

## Component reuse map (mock → existing)

| Mock element | Reuse | Net-new |
|---|---|---|
| Left code panes | `components/code-block.tsx` (Shiki server, monotone-purple themes) | pane-chrome wrapper class |
| Copy buttons | `components/copy-button.tsx` | always-visible variant CSS (explore-* precedent) |
| Agent harness card | `console/agent-prompt.tsx` + new `MARKETING_HOME_PROMPT` in `lib/agent-prompts` | harness-chip row |
| Status chips/dots | `.dash-badge-*` palette, status dot conventions | — |
| Floating status | `status/home-status-badge.tsx` (keep as-is) | — |
| Entrance stagger | `staggerIn` keyframes + `.homepage > *` pattern + reduced-motion conventions | `useInViewOnce` hook |
| Search (⌘K) | existing command-palette component | — |
| Tabs (if needed) | `console/tabbed-code.tsx` | — |
| Nav / Footer / Marquee / 6 demo panes | — | new (only genuinely new surface) |

## Sprint 1 — Shell (demoable: new hero + nav + footer live on /)
- [ ] T1 `MarketingNav`: products left (Index·Subgraphs·Streams·Datasets·Explore), right = Docs · ⌘K search (command palette) · Console. **Rollout: ALL marketing `(www)` pages — NOT docs, NOT platform** (each keeps its own nav). Style: directionally consistent w/ docs topbar — same mono-uppercase link treatment (`[D] DOCS` convention), same pill-button style as docs "Platform" button for Console CTA, same typefaces/tokens. → validates: renders both themes, keyboard nav, mobile collapse, side-by-side w/ docs topbar for consistency check
- [ ] T2 `SiteFooter`: brand + Product/Developers/Resources columns + mono block-height line (static fallback if status hook absent). → validates: dark/light, links resolve
- [ ] T3 New `(www)/page.tsx`: hero (pill, headline "Decoded once. Query forever.", sub, CTA pills), keep `HomeStatusBadge`, stagger reuse. CTA = copy `npm install @secondlayer/sdk` (mint swaps in when ghost keys ship — feature-flag the pill). → validates: dev server, updated `www.smoke.test.tsx` green
- [ ] T4 Rewrite `www.smoke.test.tsx` for new homepage assertions. → validates: bun test green
- deps: T3←T1,T2

## Sprint 2 — Demo-pane system (demoable: all 6 panes animate on a test route)
- [ ] T5 Pane primitives: `LivePane` shell (head/dot/right-counter, tabular-nums), fixed-height row-grid CSS into globals (`home-*` namespace), `useInViewOnce` (IO 0.35, reduced-motion bypass), `useDemoLoop` (interval + cleanup + pause on `document.hidden`). → validates: unit test hook cleanup
- [ ] T6–T11 one commit per pane: `StreamsBlocksPane`, `IndexResultsPane`, `SubgraphSchemaPane` (sequential card cascade), `WebhookLatencyPane` (retry resolve), `CliTerminalPane` (type→outputs ordering), `DuckdbGridPane`. → validates each: visual vs mock, CLS 0 (fixed heights), reduced-motion = final static frame, loop timings match mock (12–16s beats)
- deps: T6–T11←T5

## Sprint 3 — Sections assembly (demoable: full homepage)
- [ ] T12 Protocol marquee **derived from live data**: build-time/ISR fetch of `/v1/subgraphs`, map `sources[]` contract principals → protocol tiles (label registry for known contracts: sbtc-token→"sBTC", pox-4→"PoX-4", …; unknown contracts → shortened principal). Static fallback list when <6 public subgraphs. Auto-populates as seeds land (next phase: seed more public subgraphs). Edge mask, reduced-motion = static row, Caveat+pink note. → validates: renders from local API w/ seeded data + renders fallback when list empty
- [ ] T13 Six capability sections: `home-snippets.ts` single source for left-pane code (Shiki via CodeBlock), section head pattern (h3 + docs-link right). → validates: snippets compile-checked against SDK (see S4), copy buttons copy runnable code
- [ ] T14 Get-started split: shell card (CodeBlock) + `AgentPromptBlock` w/ `MARKETING_HOME_PROMPT` (real setup steps: skill, CLI, auth) + harness chips + Copy-all footer. → validates: prompt copy matches subgraphs-page prompt conventions
- [ ] T15 Final CTA + metadata (title/description/OG image), remove old manifest/IndexGroup home. → validates: OG preview, lighthouse run
- deps: T13←S2, T14←T13

## Sprint 4 — SDK surface reconciliation (parallel w/ S3)
- [ ] T16 Audit snippet methods vs real SDK: confirm `subgraphs.rows()` (exists), verify/implement `sl.index` read client naming (`events`, `ftTransfers`), add `sl.streams.consume()` async-iterator sugar (wraps cursor pagination + reorg surface). Changeset sdk minor. → validates: snippets in `home-snippets.ts` are type-checked imports in a `home-snippets.test.ts` that compiles them
- [ ] T17 Align docs for any new SDK sugar. → validates: docs sweep grep
- deps: T13 final copy ← T16

## Sprint 5 — Ghost keys (GATED: founder final go; scope locked 2026-06-10)
Security posture: **ghost keys are read-scoped only** (no deploys/subscriptions/key-mint — writes require claimed account) and **ghost tier = anon rate limits** (no throughput uplift until claimed → rate-limit multiplication attack is moot; in open beta a ghost key grants identity/continuity, not access). Implicit ToS at mint; IP+UA logged per mint; denylist on route.
- [ ] T18 Migration: `ghost` flag on accounts (email nullable for ghosts) + claim_tokens table (one-time, 30d expiry). → validates: migration up/down on local DB
- [ ] T19 `POST /v1/keys` anon mint: per-IP ~3/day (rate-limit store) + global daily circuit-breaker; returns key once + `claim_url`; read scopes, anon-tier limits. → validates: mint→read works, 4th mint/day 429, key cannot deploy (403)
- [ ] T20 Claim route: claim_url → email → existing magic-link → attach email, flip ghost off, key+history survive; email-already-has-account → attach key to existing account, dissolve ghost. Sweeper: unclaimed+unused ghosts deleted ~30d. → validates: e2e claim both paths, sweeper dry-run
- [ ] T21 Wire hero mint pill to real endpoint (flag flip). → validates: e2e local mint→query→claim; abuse limit test

## Final QA gate
- [ ] T22 Full pass: dark mode, 375/768/1280 widths, Lighthouse (CLS < 0.02, perf), reduced-motion sweep, tsc + biome + all suites, single conventional commit, NO push (push = deploy)

## Resolved decisions (founder, 2026-06-10)
1. Nav: MarketingNav on ALL `(www)` marketing pages; docs + platform keep their own navs; style matches docs topbar conventions (mono-uppercase links, Platform-pill button style).
2. Ghost keys: scope locked (read-only + anon-equal limits + claim flow above); final go/no-go still founder's.
3. `HomeStatusBadge`: kept.
4. Marquee: derived from live `/v1/subgraphs` `sources[]` w/ label registry + fallback; auto-populates as more public subgraphs get seeded.
