# Command Center — behavior spec

> Scope for the ⌘K search/command center replacing the ripped hosted-LLM surfaces.
> Mock: `docs/mocks/command-center-v1.html`. Successor to the 609-line fuzzy
> palette (`components/command-palette` + `lib/actions/registry`), which it
> absorbs. No LLM anywhere in this surface — detection is rules, search is
> indexes, actions are the existing REST routes.

## 1. Invocation

- `⌘K` / `ctrl+K` anywhere in the authed console; sidebar Search button dispatches the same event.
- v1 ships **console-only**. The www docs site keeps its own nav; a public
  variant is a v2 candidate, not in scope.
- Opening is free: zero network until first keystroke, except one prefetch
  (see §5). Re-opening within a session reuses warm caches.

## 2. Capabilities (v1)

Four capability classes, in fixed group order. Every result row = icon +
primary label + mono sub (path/principal) + right meta (badge/count/kbd).

### 2a. Navigate
Existing action registry (Home, Subgraphs, API Keys, Billing, Resources,
Settings, Team, Docs ↗, sign out). Fuzzy-matched, instant, local.

### 2b. Quick actions (verb-first)
| Action | Behavior on ↵ |
|---|---|
| Create subgraph from template… | second-level list in palette (the 4+ templates w/ descriptions) → ↵ routes to a prefilled create page/flow |
| Mint API key | routes to /api-keys with the create form open |
| Create webhook subscription… | second-level list of own subgraphs (+ "raw chain event") → routes to prefilled subscription form |

Rule: the palette **starts** flows and prefills; it never hosts multi-field
forms. One level of drill-down max (template picker, subgraph picker). Inline
confirm is allowed only for zero-input actions.

### 2c. Entity search
| Entity | Source | Freshness |
|---|---|---|
| Own subgraphs | authed `/api/subgraphs` | prefetched on open, SWR |
| Public subgraphs | `/v1/subgraphs` discovery JSON (name, total_rows, status, blocks_behind; ETag) | prefetched on open, SWR |
| Contracts | `/v1/contracts?q=` (contracts_find) | remote, debounced 150ms, ≥2 chars |
| Docs pages | build-time static index of docs routes + headings (title, route, section) | bundled, instant |

Own subgraphs rank above public on equal match. Subgraph rows show the live
`/v1` read path; selecting opens the subgraph detail (↵) or copies the curl
(⌘C while selected).

### 2d. Smart detection (chain-native; runs before search)
Pure client-side rules on the raw query, zero network to detect:

| Pattern | Detected as | Result rows |
|---|---|---|
| `S[PM][A-Z0-9]{38,}` (no dot) | principal | Token transfers (`/v1/index/ft-transfers?recipient=`), Transactions sent (`?sender=`), Balance in each live `*-balances` subgraph, "Watch this address…" (prefilled chain subscription) |
| principal + `.name` | contract id | Events for contract (`/v1/index/events?contract_id=`), Contract ABI, "Scaffold subgraph from this contract" |
| `(0x)?[0-9a-f]{64}` | txid | Transaction lookup (`/v1/index/transactions/:txid`) |
| `^[0-9]{4,}$` | block height | Block lookup (`/v1/index/blocks/:height`) |

Detection flips the scope chip (e.g. `address`), suppresses fuzzy noise, and
the footer states `detected in 0ms · no request sent yet`. ↵ opens the
in-console view where one exists, else opens the GET URL in a new tab.
Invalid-but-close inputs (right shape, bad checksum) still render the rows;
the API's 400 is the validator, not the palette.

## 3. Result model & ranking

- Group order is fixed: detection > actions > own subgraphs > public
  subgraphs > contracts > docs > escape hatches. Empty groups collapse.
- Cap 4 rows per group + a "More in <group>…" row that applies the scope.
- Ranking within a group: exact prefix > word-boundary fuzzy > substring;
  tie-break by recency (frecency, §6) then row count (subgraphs) / docs order.
- First row is always pre-selected; ↵ with zero typing opens the top
  suggestion (matches OpenAI behavior).

## 4. Keyboard model

| Key | Behavior |
|---|---|
| ↑ ↓ | move selection across groups |
| ↵ | open / run / drill in |
| ⌘↵ | secondary: open in new tab; on the docs escape row, run docs search |
| tab | cycle scope: all → subgraphs → contracts → docs (chip updates; detection overrides) |
| ⌘C | copy the selected row's curl/path when it has one |
| esc | clear query if non-empty, else close; drill-down esc goes up one level |
| backspace on empty | exit drill-down / clear scope |

## 5. Latency budget & data strategy

- Local groups (nav, actions, own+public subgraphs, docs index, detection):
  **<50ms keystroke→paint**. Everything needed is in memory after the open
  prefetch (discovery JSON + own subgraphs, both SWR with ETag).
- Remote group (contracts): debounce 150ms, target <250ms, render under a
  group-local shimmer; never block local groups on it.
- The footer's `N results · Xms` is real and measured; it is the performance
  contract made visible.
- Cache: localStorage for last discovery payload + docs index version;
  stale-while-revalidate on open.

## 6. Recents & frecency

- Last 50 selections in localStorage (`cc-recents`): type, id, ts, count.
- Empty state shows top recents under "jump to" before defaults; frecency
  feeds ranking tie-breaks. No server round-trip, no account sync (v1).

## 7. States

| State | Behavior |
|---|---|
| Empty | jump to (recents-aware) + your subgraphs (top 3 by recency) + quick actions; one Caveat annotation max |
| Typing, local hits | instant groups, no spinners ever for local sources |
| Typing, contracts pending | contracts group renders a 2-row shimmer; others already painted |
| No results | escape hatches only: "Search docs for 'q'", "Query Index for 'q'" (events text match), and a curl hint row |
| Remote error | contracts group silently absent; footer unchanged; never an error banner inside the palette |
| Offline/anon edge | local groups still work (nav, actions, cached discovery, docs) |

## 8. Non-goals (v1)

- No LLM/agent/ask mode in any form (just removed; stays removed).
- No in-palette forms beyond one-level pickers; no in-palette data tables or
  query previews (v2 candidate below).
- No www/marketing-site palette; no team/keys/billing entity search.
- No server-side search infra: every index is an existing endpoint or a
  build-time artifact.

## 9. v2 candidates (explicitly deferred)

- Inline result preview: run the selected GET inline, dataset-sandbox style
  (the One-Cell pattern), with the response as hero.
- Docs full-text search (minisearch over MDX content, still build-time).
- Public palette on www docs; block/tx deep views; BNS name detection
  (`name.btc` → resolve → principal flows).
- Selection telemetry to tune ranking.

## Open questions

1. Quick-action landing: prefilled *pages* (spec'd) vs an in-palette
   "create key" inline confirm that mints and shows the key in place. Inline
   mint is one fewer hop but breaks the "palette never hosts forms" rule.
2. Should public-subgraph hits open the console detail view or the public
   Explore page? (Spec assumes console detail when authed.)
3. ⌘C copy affordance: curl of the read path vs bare URL. Curl matches the
   homepage hero; bare URL is friendlier in a browser bar.
4. Docs index granularity: page-level (cheap, good enough?) vs heading-level
   (better hits, larger bundle).
