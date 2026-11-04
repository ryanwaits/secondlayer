# Dash: dashboards from the user's account

NEVER put the key in `index.html`, `spec.json` or any served file. The key lives in env and only the proxy reads it.
NEVER add write actions (pause, resume, replay, requeue, delete). The proxy denies them by design.
NEVER edit the user's own `.gitignore`.
MUST run `probe.ts` before writing a spec, and use only ids, names, tables and columns from its output.
MUST run `check.ts` and see `✓ spec ok` before starting `dev.ts`.
MUST tell the user, before any deploy: "Anyone with the URL can read this account's webhooks, subgraphs and usage. Turn on Vercel password protection or keep it local."

You build the dashboard; the user only asks. A dashboard is a spec (`spec.json`) that names components from a fixed catalog. The kit draws it, polls through a read-only proxy, and checks the spec on load. `<skill>` below is the folder holding SKILL.md.

## Location

Always `<cwd>/.secondlayer/dash/`. One dashboard per project.

- Before copying, create `.secondlayer/.gitignore` containing exactly `*` if it is missing. The folder then ignores itself and `git status` stays clean.
- A new ask edits `.secondlayer/dash/spec.json` in place. Ask before replacing panels the user didn't mention.
- Copy the kit files (`kit.js`, `kit.css`, `catalog.json`, `api/`, `lib/`, `*.ts`) verbatim and never edit them. Edit `spec.json` only.

## Steps

```bash
mkdir -p .secondlayer && [ -f .secondlayer/.gitignore ] || printf '*\n' > .secondlayer/.gitignore
[ -d .secondlayer/dash ] || cp -R <skill>/dash/template .secondlayer/dash
bun .secondlayer/dash/probe.ts [network...]   # JSON: networks → webhooks, subgraphs (+ columns), decision
# write .secondlayer/dash/spec.json from a recipe or the catalog
bun .secondlayer/dash/check.ts                # ✓ spec ok, or one line per error
PORT=4400 bun .secondlayer/dash/dev.ts        # background; prints ✓ http://localhost:<port>
```

- `probe.ts` needs `SECONDLAYER_API_KEY` in env for Mainnet and Testnet. Devnet (`SECONDLAYER_DEVNET_URL`, default `http://127.0.0.1:3800`) sends `INSTANCE_TOKEN` when set.
- Start `dev.ts` in the background. If 4400 is busy, pick a free port with `PORT`. Give the user the URL.
- The page redraws within 2s of a `spec.json` edit, with no restart.

## Networks

Pass the networks the user named to `probe.ts`. Its `decision` field applies the rule: use `decision.webhooks` or `decision.subgraphs`, whichever matches the ask.

| Ask | Networks | Tabs |
|---|---|---|
| Names a network ("my testnet webhooks") | that network only | none; write a literal `"network": "testnet"` |
| Names none | every network the probe reached that holds the resource, in the order Mainnet, Testnet, Devnet | `NetworkTabs` only with two or more |

- Devnet is included only when the probe reaches it. On a hosted page it drops out on its own.
- Testnet holds webhooks only: no subgraphs, no usage.

## Recipes

Start from `<skill>/dash/recipes/` when one fits, and compose from the catalog when none does. Replace every `<placeholder>` with a value from the probe.

| Recipe | Ask | Notes |
|---|---|---|
| `webhook-health.json` | "show me my webhooks", "are my webhooks healthy" | Set `tabs.networks` by the network rule; with one network, drop `NetworkTabs` and use literals. A delivery row opens its payload. |
| `failing-webhook.json` | "why is X failing", "show me webhook X" | One webhook id from the probe. Opens on the newest failed attempt. |
| `subgraph-rows.json` | "show me what's in my subgraph" | Rows and Schema behind one tab bar. A row opens every column. |
| `subgraph-flows.json` | "chart flows in my subgraph" | Inflow table as `table`, outflow table in `series`. A numeric column as `value` and `sum`. |
| `usage.json` | "how close am I to paying" | Mainnet only. |

## Spec

json-render's shape with our own renderer. Elements are flat, children are ids, and there is one tree from `root`.

```json
{
  "version": 1,
  "root": "page",
  "state": { "network": "mainnet" },
  "elements": {
    "page": { "type": "Page", "props": { "title": "Webhooks" }, "children": ["tabs"] },
    "tabs": { "type": "NetworkTabs", "props": { "networks": ["mainnet", "testnet"] }, "children": ["body"] },
    "body": { "type": "Stack", "children": ["sum", "table"] },
    "sum": { "type": "Summary", "props": { "network": { "$state": "/network" } } },
    "table": { "type": "WebhookTable", "props": { "network": { "$state": "/network" }, "days": 30 } }
  }
}
```

- `{ "$state": "/network" }` is the only binding. `NetworkTabs` writes `/network` for everything under it. Outside tabs, use a literal network.
- `webhookIds` omitted means every webhook on that network.
- A bad element draws as a card that names its id and prop. An unknown root fails the whole page.

## Catalog

Required props are in **bold**. Components poll every 5s (usage hourly) and pause while the tab is hidden.

| Component | Props | Reads |
|---|---|---|
| `Page` | **title**, subtitle | — |
| `Stack` | columns (1 or 2) | — |
| `Tabs` | **labels[]**, one child per label | — |
| `NetworkTabs` | **networks[]**, default | `/health`; drops networks that don't answer; no bar when one is left |
| `Summary` | **network**, webhookIds[] | `/api/webhooks` |
| `WebhookTable` | **network**, webhookIds[], days (7 or 30) | `/api/webhooks`, `/:id/activity` per webhook |
| `DeliveryFeed` | **network**, webhookIds[], limit (≤20), open (`newest-failed`) | `/:id/deliveries` per webhook, newest first; a row opens `Payload` |
| `WebhookHeader` | **network**, **webhookId** | `/:id` |
| `ListensFor` | **network**, **webhookId** | `/:id` triggers, one sentence each |
| `ActivityBars` | **network**, **webhookId**, days (30) | `/:id/activity?days=30` |
| `RetryState` | **network**, **webhookId** | `/:id`, `/:id/dead`, `/:id/activity` |
| `DataGrid` | **network**, **subgraph**, **table**, columns[], limit (≤100) | `/api/subgraphs/:n`, `/v1/subgraphs/:n/:t` newest first; a row opens `RowPanel`. Mainnet, Devnet. |
| `Schema` | **network**, **subgraph**, **table** | `/api/subgraphs/:n`. Mainnet, Devnet. |
| `Bars` | **network**, **subgraph**, **table**, **value**, bucket (blocks, default 144), series[] (more tables) | latest 1000 rows per table, bucketed in the browser. Mainnet, Devnet. |
| `Leaderboard` | **network**, **subgraph**, **table**, **key**, **sum**, limit (≤10) | latest 1000 rows, summed in the browser. Mainnet, Devnet. |
| `UsageMeter` | month (`YYYY-MM`) | `/api/billing/usage`. Mainnet. |
| `Empty` | **reason**, next | — |

`Payload` and `RowPanel` open from a row and are never placed in a spec. `Bars` and `Leaderboard` captions say "last N rows" because the server has no group-by, so never present them as full history.

Billing: every catalog read is free (webhook reads, your own subgraph tables and `/api/billing/usage` are not metered). Webhook deliveries bill when they are sent, whether or not anyone watches.

## Status

The kit follows the hosted dashboard's rules. Never add dots, badges or colors of your own.

- Healthy and neutral (delivering, paused) show nothing: plain text.
- Attention is yellow: the row tints `--hi` and the wrong value takes the `dash-mark` block.
- Failing is red: the row tints `--alarm` (`dash-row fail`), the wrong value takes `dash-mark fail`, and its chart turns red.
- Code names in a sentence are the prose font at weight 500; chips stay mono.

## Copy for agent

The page bar has one "Copy for agent" button. Tell the user that pasting what it copies is how to ask about what they see. It copies the page as it is at that moment: the open tab, the open delivery and the open row.

```
Here's my Secondlayer dashboard. Use it as context for what I ask next.

Page      <title> [· <Tab> tab (also <other tabs>)]
Network   <Mainnet|Testnet|Devnet> · <base url>
Spec      .secondlayer/dash/spec.json
As of     <YYYY-MM-DD HH:MM:SS UTC>

## On screen
<lines from each visible component>

## Open                      (only when a delivery or row is open)
<delivery: id → code, response, sent JSON | row: every column + block/tx>

## Reads behind this page (read-only, through the dashboard proxy)
GET <path>
```

When a pasted prompt arrives, answer from it first and run new reads only for what it lacks. Ids, paths and the spec it names are exact.

## Errors on the page

| Card | Fix |
|---|---|
| Key missing or wrong: set SECONDLAYER_API_KEY | Export the key in the shell that runs `dev.ts`, then restart it. |
| `<Network>` is not answering | The network is down or unreachable: drop it, or start devnet. |
| No webhook `<id>` on `<Network>` | Rerun `probe.ts` and use an id it lists. |
| Spec error in `<id>.<prop>` | Run `check.ts` and fix `spec.json`. |

## Keep or deploy

Only when the user asks.

```bash
[ -z "$(ls -A ./dashboard 2>/dev/null)" ] || { echo "./dashboard is not empty"; exit 1; }
cp -R .secondlayer/dash ./dashboard     # or the folder the user names
rm -rf .secondlayer/dash
vercel deploy ./dashboard               # deploy only
vercel env add SECONDLAYER_API_KEY      # run in ./dashboard, then redeploy
```

- Stop if the target exists and isn't empty.
- The template's own `.gitignore` (`.env*`, `.vercel`) and `.vercelignore` (`.env*`) come along.
- Never deploy from inside `.secondlayer/`: its `*` ignore can make the Vercel CLI upload nothing.
- Hosted, `api/sl/[...path].ts` runs as a Function and devnet drops out. The page warns that the URL is public and links to Vercel password protection. We add no auth of our own.
