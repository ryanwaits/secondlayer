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

### 2b. Actions & copy artifacts

**Platform principle (founder ruling 2026-06-11): the dash is
management/observability/docs/telemetry. Reads happen here. Product writes
(deploy subgraph, create webhook) do NOT happen on the dash — the palette
generates the artifact and you run it in your own tools (terminal, agent
harness via MCP).**

Real dash actions (account-plane only):
| Action | Behavior on ↵ |
|---|---|
| Mint API key | routes to /api-keys with the create form open |
| Open billing portal | existing portal redirect |

Copy artifacts (product-plane creation — ↵ copies to clipboard):
| Artifact | Drill-down (one level: format) |
|---|---|
| Create a subgraph from template X… | `sl` commands (default) · agent prompt · curl |
| Scaffold a subgraph for contract Y… | agent prompt (default, uses MCP scaffold) · `sl` commands |
| Create a webhook on table/event… | `sl` command · agent prompt · curl |
| Query recipe for current view | curl (default) · sl · agent prompt |

↵ copies the default format and the footer confirms: `copied — paste into
your agent or terminal`. ⌘↵ opens the format picker. Artifacts are generated
from the same single-sourced vocab the CLI/MCP use; they are always complete
and runnable (no <placeholders> the user must hunt for, beyond their own URL).

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
Pure client-side rules on the raw query, zero network to detect. Detection
serves the same split as 2b: **reads open, writes copy.**

| Pattern | Detected as | Read rows (↵ opens) | Artifact rows (↵ copies) |
|---|---|---|---|
| `S[PM][A-Z0-9]{38,}` (no dot) | principal | Token transfers GET, Transactions GET, Balance in live `*-balances` subgraphs | "Watch this address" → `sl subscriptions create` / agent prompt |
| principal + `.name` | contract id | Events GET, Contract ABI | "Index this contract" → agent prompt (MCP scaffold_from_contract) / `sl` commands |
| `(0x)?[0-9a-f]{64}` | txid | Transaction GET | curl for the lookup |
| `^[0-9]{4,}$` | block height | Block GET | curl for the lookup |

Detection flips the scope chip, suppresses fuzzy noise, and the footer states
`detected in 0ms · no request sent yet`. Read rows open the in-console view
where one exists, else the GET URL in a new tab; every read row also offers
⌘C copy-as-curl. Invalid-but-close inputs (right shape, bad checksum) still
render; the API's 400 is the validator, not the palette.

## 3. Result model & ranking

- Group order is fixed: detection > dash actions > copy artifacts > own
  subgraphs > public subgraphs > contracts > docs > escape hatches. Empty
  groups collapse.
- Cap 4 rows per group + a "More in <group>…" row that applies the scope.
- Ranking within a group: exact prefix > word-boundary fuzzy > substring;
  tie-break by recency (frecency, §6) then row count (subgraphs) / docs order.
- First row is always pre-selected; ↵ with zero typing opens the top
  suggestion (matches OpenAI behavior).

## 4. Keyboard model

| Key | Behavior |
|---|---|
| ↑ ↓ | move selection across groups |
| ↵ | open (reads/nav) · copy (artifacts) · drill in |
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
- **No product-plane POSTs from the dash** — no deploy, no webhook create,
  no reindex buttons in the palette. Artifacts only. (Account-plane writes —
  keys, billing — are the exception.)
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

## Resolved (founder, 2026-06-11)

- Dash = management/observability/docs/telemetry. Product creation is
  off-platform; the palette generates copyable artifacts (curl / sl / agent
  prompt) instead of hosting flows. API key creation stays a real dash action.
- Smart detection kept, reframed: reads open, writes copy.

## Open questions

1. Artifact default format: agent prompt vs `sl` commands as the ↵ default
   (spec currently varies by artifact — confirm).
2. Should public-subgraph hits open the console detail view or the public
   Explore page? (Spec assumes console detail when authed.)
3. Docs index granularity: page-level (cheap, good enough?) vs heading-level
   (better hits, larger bundle).
