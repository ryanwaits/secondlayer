---
name: secondlayer
description: Use Secondlayer to build on the Stacks blockchain — index on-chain activity into typed Postgres tables (subgraphs), stream raw and decoded events (Streams + Index), deliver row-level webhooks (subscriptions), and call Clarity contracts from a viem-style TypeScript SDK. Invoke this skill whenever the user mentions Secondlayer, `sl`, the `@secondlayer/*` packages, Stacks indexing, sBTC, BNS, PoX/stacking, Clarity contract reads/calls, post-conditions, webhook subscriptions on chain events, or asks how to query, watch, or react to anything happening on the Stacks chain — even if they don't name Secondlayer explicitly.
---

# Secondlayer

Secondlayer is a stack of tools for building on the **Stacks blockchain**:

| Layer | Package / Surface | What it does |
|---|---|---|
| **L1 raw events** | `@secondlayer/sdk` → `sl.streams` · REST `/v1/streams` · `sl streams` | Cursor-paginated firehose of raw Stacks events (transfers, mints, burns, prints) with reorg awareness, Bitcoin-anchored finality (`finalized` per event, `finalized_height` on tip), `types`/`not_types` + `sender`/`recipient`/`contract_id` (single or comma-list) payload filters, signed responses (ed25519 `X-Signature`, opt-in SDK `verify`), and public bulk parquet dumps (`client.dumps` / `events.replay` / `sl streams pull`). |
| **L2 decoded events** | `@secondlayer/sdk` → `sl.index` · REST `/v1/index` · `sl index` | The full decoded layer: SIP-010 (FT) and SIP-009 (NFT) transfers, all event types (`stx_*`, ft/nft mint/burn, print) via `events`, and decoded `contract-calls` — filtered by principal/contract/height. |
| **L3 app-specific tables** | `@secondlayer/subgraphs` + CLI · REST `/v1/subgraphs` (public reads) · `/api/subgraphs` (authed management) | TypeScript-authored indexers: declare filters + schema + handlers; Secondlayer materializes Postgres tables and exposes REST — public subgraphs anon-readable on `/v1/subgraphs`. |
| **Webhooks** | `sl.subscriptions` · REST `/api/subscriptions` · `sl subscriptions` | Standard-Webhooks-signed deliveries. Two kinds: **subgraph** subscriptions fire on every row written by a subgraph; **chain** subscriptions fire on raw chain events directly (no subgraph) via `triggers` (contract call / event type / trait). |
| **Chain client** | `@secondlayer/stacks` | viem-style SDK: public/wallet clients, `Cl.*`, `Pc.*`, `getContract`, BNS / PoX / sBTC / StackingDAO extensions. |
| **CLI** | `@secondlayer/cli` (binary `sl`) | Every one of the above is reachable from `sl`. |

The packages are independent — pick whichever layer fits the task.

## Decision tree — which reference to load

Before doing the task, load the smallest set of reference files that cover it. Reference files live in `references/`. They contain the exact public surface (function signatures, flags, response shapes) verified against the source.

| If the user wants to… | Load |
|---|---|
| Install the CLI, log in, set up env vars, install an SDK package | `references/installation.md` |
| Run any `sl` command (subgraphs, subscriptions, streams, projects, local, account) | `references/cli.md` |
| Call the platform API from TypeScript (`new SecondLayer(...)`, `sl.streams`, `sl.subgraphs`, `sl.subscriptions`, `sl.index`) | `references/sdk.md` |
| Write or edit a subgraph file (`defineSubgraph`, sources, schema, handlers, `ctx.*`) | `references/subgraph-authoring.md` |
| Read or call a Clarity contract, sign STX/contract transactions, work with Clarity values, post-conditions, accounts, transports | `references/stacks.md` |
| Use BNS, PoX/stacking, sBTC, or StackingDAO | `references/stacks-extensions.md` |
| Hit the REST API from a language without an SDK (curl, Python, Go) | `references/api-rest.md` |
| Set up MCP for an agent to manage subgraphs/subscriptions | `references/mcp.md` |
| Diagnose a stalled subgraph, a paused/failing subscription, dead letters, replays | `references/troubleshooting.md` |

For working code, see `examples/` — every file is copy-pasteable and verified.

## Always-true facts

These are small enough to keep in the router. Everything else is in a reference file.

- **Binary:** `sl` (aliased `secondlayer`). Install: `bun add -g @secondlayer/cli`.
- **Default platform API:** `https://api.secondlayer.tools`. Override with `SL_API_URL`.
- **CLI auth:** `sl login` → magic-link → session in `~/.secondlayer/session.json` (90-day sliding). Tenant-scoped commands auto-mint 5-minute service JWTs per invocation; no long-lived key on disk.
- **Streams auth:** `SL_API_KEY` env var (issued from the dashboard). **`/v1/streams/*` reads REQUIRE a bearer token** and resolve a per-tier tenant (free/build/scale/enterprise) — a publicly-known free-tier token exists but a bearer is always required. (The public `/public/streams/*` dump/signing-key endpoints need no auth.)
- **Reads + write gates:** Index (`/v1/index/*`) reads are anonymous (no auth) or with any key incl. free-tier; Streams reads need a bearer (above). Free/anonymous reads cover the **recent 24-hour window** — a read into older history returns `402 UPGRADE_REQUIRED`; reach older history via pay-as-you-go credits or a paid plan. **Deploying a subgraph or creating a webhook requires a paid plan or a 14-day trial** (free → `403 PLAN_REQUIRED`). Other writes (delete, rotate, replay) require auth. Don't fabricate auth steps for the anonymous read-only queries.
- **Pay-as-you-go credits:** a free account can top up prepaid credits with a card (packs $10/$25/$50/$100, `POST /api/billing/topup`). With a positive balance the account reads beyond the 24h window, unthrottled, debited $5 per 1,000,000 rows across both Index and Streams from one shared balance; the prepaid balance is the hard cap. Card-funded peer to the x402 agent rail.
- **Package manager:** prefer `bun` and `bunx`. Most package.json files in user projects declare `bun` as `packageManager`.
- **Network inference:** addresses starting `SP`/`SM` → mainnet, `ST`/`SN` → testnet. CLI infers this automatically when scaffolding.

## Read-auth tiers

Reads are not uniformly open — know the tier before querying:

| Surface | Auth |
| --- | --- |
| Contracts (`/v1/contracts`, `sl.contracts`) | **Open** — no key |
| Index (`/v1/index`, `sl.index`, `sl index`) | Anonymous reads OK; **free-tier keys allowed** (free-tier rate limit; a minted free key is never slower than anonymous). Free/anon reads cover the recent 24h window — older history → `402 UPGRADE_REQUIRED` (pay-as-you-go credits or a plan) |
| Streams (`/v1/streams`, `sl.streams`, `sl streams`) | **API key required** (`SL_API_KEY`) — keyless 401. Free retention 1 day; older history → credits or plan |
| Subgraphs reads | **Public** subgraphs open on `/v1/subgraphs/*` (anon, wildcard CORS); **private** subgraphs need the owner's `sk-sl_` key on /v1 (anon → 404). Pre-existing subgraphs were migrated **private** — no longer anon-readable. Writes + `publish`/`unpublish` require a key |

## Default working loop

0. **Discover what exists.** Don't assume — enumerate at runtime: `sl.contracts.list({ trait })` for contracts implementing a trait, and (over MCP) read `secondlayer://context` for your subgraphs/subscriptions/account + capabilities.
1. **Identify the layer.** Is this a subgraph (custom indexer)? A decoded-events query (`sl.index`)? A raw stream consumer? A direct contract call? Pick the right tool — don't reach for a subgraph when `sl.index.ftTransfers.list({ recipient })` does the job in one HTTP call.
2. **Inspect first.** Before changing anything tenant-scoped, run a read (`sl subgraphs list`, `sl subscriptions get …`). Confirms auth + state, prevents accidental overwrites.
3. **Scaffold the smallest correct thing.** Use `sl subgraphs scaffold <contract>` or `sl subscriptions create <name>` rather than hand-writing boilerplate. Both generate code that's already 1:1 with current package APIs.
4. **Validate locally.** For subgraphs: `sl subgraphs spec <file>` to preview generated schema and API without deploying. For SDK code: type-check.
5. **Confirm before destructive actions.** Always pause to confirm: `sl subgraphs delete`, `sl subgraphs reindex` (drops + reprocesses), `sl subscriptions rotate-secret`, `sl subscriptions replay`, `sl subscriptions requeue`. The CLI prompts by default; if running in non-TTY, pass `-y` only with explicit user consent.
6. **Verify after.** `sl subgraphs status <name>` after deploy. `sl subscriptions deliveries <name>` after creating a subscription.

## Code quality bar

- **Never invent function names, flags, or env vars.** When uncertain, load the matching reference file. Hallucinated APIs are the single highest-cost failure mode for this skill.
- **Use real types, not `any`.** The packages are aggressively typed; `defineSubgraph`, `getContract`, and `sl.subgraphs.typed(def)` infer column → row types automatically.
- **bigint for amounts.** STX is microSTX (`1_000_000n` = 1 STX). FT amounts are bigint. Never use floats for token amounts.
- **Post-conditions on every wallet transaction.** `postConditionMode: "deny"` (the default) blocks the tx unless every asset movement is asserted. Tell the user when you omit them and why.
- **Don't surface signing secrets after `create` / `rotate-secret`.** They're returned once; the user stores them in their receiver's `.env`. If you have the secret in chat, treat it as sensitive.

## Common-mistake guard rails

| Symptom | Likely cause | Fix |
|---|---|---|
| Subgraph deploy errors `upsert requires unique key` | Schema declared `upsert` writes but `uniqueKeys` missing | Add `uniqueKeys: [["col_a", "col_b"]]` to the table |
| Subscription paused after 20 failures | Receiver returning 4xx/5xx or timing out | `sl subscriptions doctor <name>`; fix receiver; `sl subscriptions resume <name>` |
| `ApiError 401` from SDK | Missing `apiKey` or expired session | Pass `apiKey` to the client (commonly from `SL_API_KEY`) / regenerate from dashboard; for CLI run `sl login` |
| `tsc` errors after `getContract` upgrade | ABI shape changed, regenerate | `sl subgraphs client <name> -o ...` or refresh ABI |
| Webhook receiver getting unsigned bodies | `format` not set to `standard-webhooks` | `sl subscriptions update <name> --format standard-webhooks` |
| Subgraph "stuck" right after deploy | Catching up from `startBlock` | Normal; watch `sl subgraphs status <name> -w`. Use `--start-block` near tip for fast first deploy |

When the user asks "why isn't this working" and the symptom isn't on this list, load `references/troubleshooting.md`.
