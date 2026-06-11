# Command Center — v1 spec (navigation + discovery only)

> Founder ruling 2026-06-11 (final): dead simple, super fast. Navigation
> shortcuts + fuzzy search across the user's resources. No verb actions, no
> writes, no LLM, no detection, no copy artifacts. Selecting a result OPENS
> its page. That is the entire contract.
>
> Everything richer is parked, not dead — explored and preserved in
> `docs/mocks/command-center-v1.html` (entity search + artifacts),
> `command-center-v2-agent.html` (inline one-shot agent), and
> `command-center-v3-interactive.html` (three approval patterns, driveable).
> Revisit only on real user pull.

## 1. Invocation

- `⌘K` / `ctrl+K` anywhere in the authed console; the sidebar Search button
  dispatches the same event. Console-only.
- Zero network on open beyond one prefetch (§4). Re-open reuses warm caches.

## 2. Capabilities — two, exactly

### 2a. Navigation shortcuts
Static route registry (the surviving `lib/actions/registry`): Home,
Subgraphs, API Keys, Billing, Resources, Settings, Team, Docs ↗, Pricing ↗,
Explore ↗, sign out. Fuzzy-matched, instant.

### 2b. Fuzzy resource search
| Entity | Source | Opens |
|---|---|---|
| Own subgraphs | authed `/api/subgraphs` | `/subgraphs/:name` detail |
| Own subscriptions | authed `/api/subscriptions` | subscription detail |
| Public subgraphs | `/v1/subgraphs` discovery JSON (ETag) | console detail when authed |
| Docs pages | build-time static index (title + route) | the docs page (new tab) |

Rows show identity + one mono context line (subgraph: status badge + row
count; subscription: status + target table; docs: section). No actions on
rows. `⌘↵` opens in a new tab. That is the full interaction surface.

## 3. Ranking

- Group order: navigation > own subgraphs > own subscriptions > public
  subgraphs > docs. Empty groups collapse; cap 5 rows per group.
- Within a group: exact prefix > word-boundary fuzzy > substring; ties break
  by frecency (§5), then row count / docs order.
- First row pre-selected; ↵ on an empty query opens the top suggestion.

## 4. Performance (the actual feature)

- **Every source is local after one prefetch.** No remote search calls, no
  debounce, no spinners, ever. The contracts endpoint was cut from scope
  precisely because it was the only remote dependency.
- Budget: **<30ms keystroke→paint**, palette open→interactive <100ms.
- Prefetch on first open: own subgraphs + own subscriptions + discovery JSON
  (all SWR with ETag; last payloads in localStorage so a cold open still
  paints instantly from stale data while revalidating).
- Docs index is bundled at build time (page-level: title, route, section —
  tens of entries, not a search engine).
- Footer shows measured truth: `N results · Xms`.

## 5. Recents & frecency

Last 50 selections in localStorage (`cc-recents`). Empty state = navigation
shortcuts with recents boosted + the user's 3 most-recent resources. No
server round-trip, no sync.

## 6. Keyboard

| Key | Behavior |
|---|---|
| ↑ ↓ | move selection |
| ↵ | open |
| ⌘↵ | open in new tab |
| esc | clear query if non-empty, else close |

No scopes, no tabs, no drill-downs, no chords.

## 7. States

| State | Behavior |
|---|---|
| Empty | nav shortcuts (recents-boosted) + 3 recent resources |
| Typing | instant grouped results; no loading states exist |
| No results | one row: `Open docs ↗` + the measured footer; nothing else |
| Stale cache, offline | results from localStorage payloads; silently revalidates |

## 8. Out of scope (parked with mocks, revisit on pull)

- Inline verb actions of any kind (pause/delete/manage) — v3 mock holds the
  three approval patterns if this ever returns.
- One-shot agent ask / generative UI — v2-agent mock.
- Smart detection (principal/txid/contract paste) and copy artifacts — v1 mock.
- Contracts search (remote), scopes, drill-down pickers, www palette,
  full-text docs search, telemetry.

## 9. Build sketch (~1-2 days)

Extends the existing 609-line palette rather than replacing it:
1. Keep `command-palette.tsx` shell + `fuzzy-match`; registry stays the nav
   source.
2. Add a `useCommandSources()` hook: prefetch + SWR + localStorage for the
   three resource feeds; merge into grouped, ranked results.
3. Docs index: small build-time JSON generated from the docs nav config
   (`docs/nav.ts` already enumerates every page).
4. Frecency: tiny localStorage helper, no deps.
5. Measure and render the footer ms honestly (`performance.now()` around
   filter+rank+render).

Mock reference for visuals: `command-center-v1.html` EMPTY + “sbtc” states,
minus the actions/artifacts groups and the scope chip.
