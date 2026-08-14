---
name: secondlayer
description: Use Secondlayer to build on the Stacks blockchain — index on-chain activity into typed Postgres tables (subgraphs), stream raw and decoded events (Streams + Index), deliver row-level webhooks (subscriptions), and call Clarity contracts from a viem-style TypeScript SDK. Invoke this skill whenever the user mentions Secondlayer, `sl`, the `@secondlayer/*` packages, Stacks indexing, sBTC, BNS, PoX/stacking, Clarity contract reads/calls, post-conditions, webhook subscriptions on chain events, or asks how to query, watch, or react to anything happening on the Stacks chain — even if they don't name Secondlayer explicitly.
---

# Secondlayer

Secondlayer is a self-hosted Stacks data runtime. Postgres plus one container.

| Surface | Package / Surface | What it does |
|---|---|---|
| **Raw (Streams)** | `@secondlayer/sdk` → `sl.streams` · REST `/v1/streams` · `sl streams` | Cursor-paginated firehose of raw Stacks events (transfers, mints, burns, prints) with reorg awareness, Bitcoin-anchored finality (`finalized` per event, `finalized_height` on tip), `types`/`not_types` + `sender`/`recipient`/`contract_id` (single or comma-list) payload filters, signed responses (ed25519 `X-Signature`, opt-in SDK `verify`), and public bulk parquet dumps (`client.dumps` / `events.replay` / `sl streams pull`). |
| **Decoded (Index)** | `@secondlayer/sdk` → `sl.index` · REST `/v1/index` · `sl index` | Decoded SIP-010 (FT) and SIP-009 (NFT) transfers, all event types (`stx_*`, ft/nft mint/burn, print) via `events`, and decoded `contract-calls` — filtered by principal/contract/height. |
| **Your schema (Subgraphs)** | `@secondlayer/subgraphs` + CLI · REST `/v1/subgraphs` (reads) · `/api/subgraphs` (writes) | TypeScript-authored indexers: declare filters + schema + handlers; the instance materializes Postgres tables and exposes REST. |
| **Webhooks** | `sl.subscriptions` · REST `/api/subscriptions` · `sl subscriptions` | Standard-Webhooks-signed deliveries. Two kinds: **subgraph** subscriptions fire on every row written by a subgraph; **chain** subscriptions fire on raw chain events directly (no subgraph) via `triggers` (contract call / event type / trait). |
| **Chain client** | `@secondlayer/stacks` | viem-style SDK: public/wallet clients, `Cl.*`, `Pc.*`, `getContract`, BNS / PoX / sBTC / StackingDAO extensions. |
| **CLI** | `@secondlayer/cli` (binary `sl`) | Every one of the above is reachable from `sl`. |

The packages are independent — pick whichever surface fits the task.

## Decision tree — which reference to load

Before doing the task, load the smallest set of reference files that cover it. Reference files live in `references/`. They contain the exact public surface (function signatures, flags, response shapes) verified against the source.

| If the user wants to… | Load |
|---|---|
| Install the CLI, log in, set up env vars, install an SDK package | `references/installation.md` |
| Run any `sl` command (subgraphs, subscriptions, streams, projects, local, account) | `references/cli.md` |
| Call this instance from TypeScript (`new SecondLayer(...)`, `sl.streams`, `sl.subgraphs`, `sl.subscriptions`, `sl.index`) | `references/sdk.md` |
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
- **Default API:** `http://127.0.0.1:3800`. Override with `SL_API_URL`.
- **CLI auth:** `sl init` writes `INSTANCE_TOKEN`. Set `SL_API_KEY` to that token for writes. No Secondlayer account.
- **Streams / Index:** local instance reads. Loopback needs no key. Public archive dumps (`sl streams pull`) are a separate signed bucket.
- **Package manager:** prefer `bun` and `bunx`. Most package.json files in user projects declare `bun` as `packageManager`.
- **Network inference:** addresses starting `SP`/`SM` → mainnet, `ST`/`SN` → testnet. CLI infers this automatically when scaffolding.

## Read-auth tiers

Reads are not uniformly open — know the tier before querying:

| Surface | Auth |
| --- | --- |
| Contracts (`/v1/contracts`, `sl.contracts`) | **Open** — no key |
| Index (`/v1/index`, `sl.index`, `sl index`) | Loopback reads need no key. History is whatever this instance has bootstrapped. |
| Streams (`/v1/streams`, `sl.streams`, `sl streams`) | Loopback reads need no key. Public archive dumps need no instance key. |
| Subgraphs | Reads on this instance are open on `/v1/subgraphs/*`. Writes use `INSTANCE_TOKEN` from `sl init` as `SL_API_KEY`. |

## Default working loop

0. **Discover what exists.** Don't assume — enumerate at runtime: `sl.contracts.list({ trait })` for contracts implementing a trait, and (over MCP) read `secondlayer://context` for your subgraphs/subscriptions/account + capabilities.
1. **Identify the surface.** Is this a subgraph (your schema)? A decoded-events query (`sl.index`)? A raw stream consumer? A direct contract call? Pick the right tool — don't reach for a subgraph when `sl.index.ftTransfers.list({ recipient })` does the job in one HTTP call.
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
| `ApiError 401` from SDK | Missing `apiKey` on a write, or the API is bound beyond loopback | Pass `INSTANCE_TOKEN` from `sl init` as `apiKey` / `SL_API_KEY` |
| `tsc` errors after `getContract` upgrade | ABI shape changed, regenerate | `sl subgraphs client <name> -o ...` or refresh ABI |
| Webhook receiver getting unsigned bodies | `format` not set to `standard-webhooks` | `sl subscriptions update <name> --format standard-webhooks` |
| Subgraph "stuck" right after deploy | Catching up from `startBlock` | Normal; watch `sl subgraphs status <name> -w`. Use `--start-block` near tip for fast first deploy |

When the user asks "why isn't this working" and the symptom isn't on this list, load `references/troubleshooting.md`.
