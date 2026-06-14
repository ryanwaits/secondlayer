# Secondlayer CLI (`sl`) Reference

The `sl` binary (alias `secondlayer`) is the official CLI for Secondlayer — dedicated Stacks indexing + real-time subgraphs. Install globally with `bun add -g @secondlayer/cli`. The binary is named `secondlayer`; `sl` is a Commander alias for the same entry point. All commands accept a global `--network <network>` flag (`local`, `testnet`, `mainnet`) which is equivalent to setting `STACKS_NETWORK` before the call.

## Global flags

| Flag | Description |
| --- | --- |
| `--network <network>` | Override network for this invocation (sets `STACKS_NETWORK`). Values: `local`, `testnet`, `mainnet`. |
| `--version` | Print CLI version. |
| `--help` | Show help. |

**Output contract (for scripting/agents):** data goes to **stdout**, status/chrome to **stderr** (color auto-disables when piped). On platform read commands `--json` selects the full JSON envelope; `sl streams`/`sl index` already emit JSON to stdout (the `--json` flag is accepted there for uniformity). `-o, --output <path>` always means a **file path** (codegen/spec), never a format selector.

## Environment variables

| Var | Used by | Purpose |
| --- | --- | --- |
| `SL_API_URL` | subscriptions, create | Override tenant API base URL. |
| `SL_API_KEY` | subscriptions, create, streams, MCP, SDK | API key for tenant/platform API auth (write scope) and Streams reads (issued in dashboard). |
| `SL_PLATFORM_API_URL` | doctor (hosted) | Override platform API URL (default `https://api.secondlayer.tools`). |
| `HIRO_API_KEY` / `STACKS_NODE_API_KEY` | subgraphs scaffold, contracts generate | API key passed to Hiro Stacks RPC when fetching contract ABIs. |
| `SIGNING_SECRET` | subscriptions test | Standard-Webhooks signing secret used to sign test fixtures. |
| `STACKS_NETWORK` | global | Network override (set by `--network`). |
| `SL_STREAMS_DUMPS_URL` | streams pull | Public bulk-dump bucket base URL (dumps are public — no API key). Alternative to `--dumps-url`. |
| `DATABASE_URL` | local db | Postgres URL for local indexer DB; defaults to `postgres://postgres:postgres@localhost:5432/secondlayer_dev`. |
| `INDEXER_URL` | local db resync --backfill | Local indexer URL; defaults to `http://localhost:<config.ports.indexer>`. |
| `DEBUG` | contracts generate | When set, prints stack traces on failure. |

Global flags `--api-key <key>` and `--api-url <url>` are available on every command and override `SL_API_KEY` / `SL_API_URL` for that invocation.

## Table of contents

- [Auth](#auth) — `login`, `logout`, `whoami`, `keys create`
- [Projects](#projects) — `projects create|list|use|get`
- [Subgraphs](#subgraphs) — `create`, `dev`, `deploy`, `list`, `status`, `spec`, `reindex`, `backfill`, `cancel`, `gaps`, `query`, `delete`, `scaffold`, `client`, `codegen`
- [Subscriptions](#subscriptions) — `create`, `list`, `get`, `update`, `pause`, `resume`, `delete`, `rotate-secret`, `deliveries`, `dead`, `requeue`, `replay`, `doctor`, `test`
- [Streams](#streams) — `tip`, `events`, `consume`, `reorgs`, `canonical`, `pull`
- [Local](#local) — `local up|down|restart|status|logs`, `local node …`, `local db …`
- [Devnet](#devnet) — `local up --devnet` / `local down --devnet`, `devnet status|logs` (run services against a Clarinet devnet)
- [Account](#account) — `account get`, `account update`, `account billing`
- [Config](#config) — `config get|set|reset|delete`
- [Status](#status) — top-level `status`
- [Doctor](#doctor) — top-level `doctor`
- [Contracts generate](#contracts-generate) — `contracts generate` (alias `contracts gen`), `init`

---

## Auth

Magic-link email session. Session token is written to a local file managed by `~/.config/secondlayer` (or platform equivalent). Server auto-extends on every authed request.

### sl login

Magic-link email login (interactive only).

Usage: `sl login`

No flags. Prompts for email, POSTs `/api/auth/magic-link`, then prompts for a 6-digit code and POSTs `/api/auth/verify`. On success writes session to disk. In dev mode the server echoes the code in the response.

Example: `sl login`

### sl logout

Log out and revoke the local session.

Usage: `sl logout`

No flags. POSTs `/api/auth/logout`; clears local session even if the server call fails.

### sl whoami

Show current authenticated account + active project, plus the effective API URL and credential source.

Usage: `sl whoami`

No flags. Reads local session (or `SL_API_KEY`), calls `/api/accounts/me`, and prints email, plan, the active project (from `./.secondlayer/project`, walking up the directory tree, falling back to global `defaultProject`), the effective API URL, and where the credential came from. **Exits non-zero when not logged in** — useful as a CI auth check.

Headless / CI login (no magic-link prompt): pipe a key into `--with-token`:

```bash
echo "$SL_API_KEY" | sl login --with-token
```

### sl keys create

Mint a **scoped** read key without the dashboard.

Usage: `sl keys create --product streams [--name <name>]`

`--product` is `streams` or `index` (single-product, read-only). Prints the new `sk-sl_…` key **once** — store it immediately. **Requires an account/owner key** in `SL_API_KEY` (or session): a scoped key cannot mint (403). Minted keys inherit your account plan's tier and can never be an account key.

**Key products:** an `account` key (dashboard default) grants both `streams:read` and `index:read` and is the only key that can mint; `streams`/`index` keys are scoped reads and cannot mint.

---

## Projects

Account-scoped project management. Each project maps 1:1 to a dedicated tenant. Binding a project to a directory writes `./.secondlayer/project` (recommend adding `.secondlayer/` to `.gitignore` — it's account-personal).

### sl projects create

Create a new project.

Usage: `sl projects create [name]`

| Flag | Description |
| --- | --- |
| `--slug <slug>` | Explicit URL slug (defaults to slugified name). Must be 2-63 chars, `[a-z0-9-]`, start/end with alphanumeric. |

Prompts for a name if not provided. POSTs `/api/projects`. First project becomes the global `defaultProject`.

Example: `sl projects create "My Watcher" --slug my-watcher`

### sl projects list

List projects in your account.

Usage: `sl projects list`

No flags. GETs `/api/projects`. Marks the active project with `*`.

### sl projects use

Bind this directory to a project (writes `./.secondlayer/project`).

Usage: `sl projects use <slug>`

No flags. Verifies project exists via `GET /api/projects/:slug` before writing the binding file.

Example: `sl projects use my-watcher`

### sl projects get

Show the active project for this directory.

Usage: `sl projects get`

No flags. Prints the active slug and resolution source (`.secondlayer/project` in cwd / parent dir / global default).

### sl projects delete

Delete a project. Alias: `rm`.

Usage: `sl projects delete <slug>` (`-y, --yes` to skip confirmation; refuses to prompt on non-TTY stdin). Deleting your only/last project is rejected by the API.

---

## Subgraphs

Manage materialized subgraphs. Most subcommands hit the active tenant's API (resolved via session + active project) and require `sl login` unless `--service-key`/`SL_API_KEY` is set. Local deploys (`network=local`) skip auth and write to the local Postgres dev DB.

### sl subgraphs create

Scaffold a new subgraph definition file at `./subgraphs/<name>.ts`.

Usage: `sl subgraphs create <name>`

| Flag | Default | Description |
| --- | --- | --- |
| `--template <slug>` | `basic` | Foundation Dataset starter. One of: `basic`, `sip-010-balances`, `sbtc-flows`, `pox-stacking`, `bns-names`. |

Writes to `subgraphs/<name>.ts` (creates `subgraphs/` if missing). Errors if the file already exists.

Example: `sl subgraphs create my-watcher --template sip-010-balances`

### sl subgraphs dev

Watch a subgraph file and auto-redeploy on change (LOCAL ONLY — requires `network=local`).

Usage: `sl subgraphs dev <file>`

No flags. Deploys once, then re-deploys on file changes (300ms debounce). Reads/writes directly to local Postgres via `@secondlayer/shared/db`. Ctrl-C to stop.

Example: `sl subgraphs dev subgraphs/my-watcher.ts`

### sl subgraphs deploy

Deploy a subgraph definition file. Alias: `sl subgraphs update <file>` — deploy is create-or-update.

Usage: `sl subgraphs deploy <file>`

| Flag | Default | Description |
| --- | --- | --- |
| `--start-block <n>` | (from definition) | Override definition's `startBlock` for this deploy (nonneg integer). |
| `--visibility <public\|private>` | managed → `public`, BYO → `private` | Read visibility: `public` = anon /v1 reads + global name claim; `private` = your key only. |
| `--dry-run` | false | Validate and preview without writing. |
| `-y, --yes` | false | Skip confirmation prompt for reindex operations (DROP + reindex). |
| `--strict` | false | Run `bunx tsc --noEmit` on handler before deploy. |

Remote deploy (non-local): bundles handler via `@secondlayer/bundler`, POSTs to tenant API. Server returns one of `unchanged`, `handler_updated`, `created`, `updated`, `reindexed`. **Destructive (`reindexed`) deploys prompt for confirmation** unless `-y` is set. Local deploy: writes to local DB via `deploySchema()`.

Example: `sl subgraphs deploy subgraphs/my-watcher.ts --start-block 100000`

### sl subgraphs publish / unpublish

Flip a deployed subgraph's read visibility.

Usage: `sl subgraphs publish <name>` / `sl subgraphs unpublish <name>`

`publish` claims the name in the single global public namespace and opens anon /v1 reads — a taken name fails with `409 PUBLIC_NAME_TAKEN`. `unpublish` returns it to private (owner-key reads only).

### sl subgraphs list

List all deployed subgraphs (alias: `ls`).

Usage: `sl subgraphs list`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |

### sl subgraphs status

Show detailed subgraph status (sync, gaps, errors, table row counts, endpoints).

Usage: `sl subgraphs status <name>`

| Flag | Description |
| --- | --- |
| `-w, --watch` | Refresh every 2s until synced or Ctrl-C. Clears screen between renders. |

Example: `sl subgraphs status my-watcher -w`

### sl subgraphs spec

Output API documentation for a subgraph. Accepts either a **deployed subgraph name** (fetched from the API) or a **local `.ts` file** (bundled in-process, no API call).

Usage: `sl subgraphs spec <nameOrFile>`

| Flag | Default | Description |
| --- | --- | --- |
| `--format <format>` | `openapi` | One of: `openapi`, `agent`, `markdown`. |
| `-o, --output <path>` | (stdout) | Write to file instead of stdout. |
| `--server <url>` | (from API) | Override server URL in generated docs. |

Examples:
```bash
sl subgraphs spec my-watcher --format agent -o ./docs/my-watcher.json   # deployed name
sl subgraphs spec subgraphs/my-watcher.ts                               # local file, no server call
```

### sl subgraphs reindex

**DESTRUCTIVE.** Reindex a subgraph from historical blocks (drops existing rows in range, reprocesses).

Usage: `sl subgraphs reindex <name>`

| Flag | Description |
| --- | --- |
| `--from-block <block>` | Start block height (integer). |
| `--to-block <block>` | End block height (integer). |
| `-y, --yes` | Skip the confirmation prompt. |

Prompts for confirmation by default (default answer: **no**). Non-TTY environments must pass `-y` or the command exits non-zero. Added in `@secondlayer/cli` 5.5.0; older versions ran silently.

### sl subgraphs backfill

Backfill a block range without dropping existing data.

Usage: `sl subgraphs backfill <name> --from-block <block> --to-block <block>`

| Flag | Required | Description |
| --- | --- | --- |
| `--from-block <block>` | yes | Start block height. |
| `--to-block <block>` | yes | End block height. |

### sl subgraphs cancel

Cancel a running reindex or backfill operation.

Usage: `sl subgraphs cancel <name>`

No flags.

### sl subgraphs gaps

Show block gaps for a subgraph.

Usage: `sl subgraphs gaps <name>`

| Flag | Default | Description |
| --- | --- | --- |
| `--resolved` | false | Include resolved gaps. |
| `--limit <n>` | `50` | Max gaps to return. |
| `--json` | false | Output as JSON. |

### sl subgraphs query

Query a subgraph table.

Usage: `sl subgraphs query <name> <table>`

| Flag | Default | Description |
| --- | --- | --- |
| `--sort <column>` | — | Sort by column. |
| `--order <dir>` | `asc` | `asc` or `desc` (only applied when `--sort` is set). |
| `--limit <n>` | `20` | Max rows. |
| `--offset <n>` | — | Skip first N rows. |
| `--fields <cols>` | — | Comma-separated columns. |
| `--filter <kv...>` | — | Repeatable. `key=value`. Suffixes: `.eq`, `.neq`, `.gt`, `.gte`, `.lt`, `.lte`. |
| `--count` | false | Return row count only. |
| `--json` | false | Output as JSON. |

Example: `sl subgraphs query my-watcher transfers --sort _block_height --order desc --limit 50 --filter amount.gte=1000`

### sl subgraphs delete

**DESTRUCTIVE.** Delete a subgraph and all its data.

Usage: `sl subgraphs delete <name>`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |
| `--force` | Cancel active operations and force delete. |

Refuses to run without a TTY unless `-y` is passed. Idempotent: a 404 after a previous delete prints "already deleted" rather than erroring.

### sl subgraphs scaffold

Scaffold a deploy-ready `defineSubgraph()` file (real handlers, not stubs).
**Standard-aware**: it classifies the contract's ABI and emits the *useful* source —
a SIP-010 token → an `ft_transfer` source over its asset, a SIP-009 → `nft_transfer`,
anything else → a single generic `calls` table.

Usage: `sl subgraphs scaffold [contractAddress]`

| Flag | Required | Description |
| --- | --- | --- |
| `-o, --output <path>` | yes | Output file path. |
| `--functions <a,b>` | no | Index these public functions as typed `contract_call` tables (positional arg decode) instead of the generic `calls` table. |
| `--trait <std>` | no | Scaffold a **trait-scoped** source (`sip-009\|sip-010\|sip-013`) that indexes every conforming contract — no `<contractAddress>` needed. |
| `--api-key <key>` | no | Stacks API key (fallback to `STACKS_NODE_API_KEY` / `HIRO_API_KEY`). |
| `--no-install` | no | Skip `bun install` in output directory. |

Examples:
```bash
sl subgraphs scaffold SM3VD….sbtc-token -o subgraphs/sbtc.ts        # → ft_transfer source
sl subgraphs scaffold SP….amm --functions swap,add-liquidity -o subgraphs/amm.ts
sl subgraphs scaffold --trait sip-010 -o subgraphs/all-tokens.ts    # all SIP-010 tokens
```

### sl subgraphs client

Generate a typed TypeScript query client for a deployed subgraph. (Formerly
`sl subgraphs generate` — still accepted as a deprecated alias.)

Usage: `sl subgraphs client <subgraphName>`

| Flag | Required | Description |
| --- | --- | --- |
| `-o, --output <path>` | yes | Output file path. |

Fetches subgraph metadata, emits typed query client. For an ORM schema on your
own database instead, see `sl subgraphs codegen`.

Example: `sl subgraphs client my-watcher -o ./src/generated/my-watcher.ts`

### sl subgraphs codegen

Generate an ORM schema (Prisma or Drizzle) for a subgraph's tables — the
companion to BYO database (`sl subgraphs deploy --database-url`). Point the ORM
at your own Postgres for a fully-typed client with relations and joins.

Usage: `sl subgraphs codegen <file>`

| Flag | Default | Description |
| --- | --- | --- |
| `--target <orm>` | `prisma` | `prisma` or `drizzle`. (Kysely: run `kysely-codegen` against your DB.) |
| `--schema <name>` | `subgraph_<name>` | Postgres schema the tables live in. |
| `--env <var>` | `DATABASE_URL` | datasource url env var (Prisma only). |
| `--models-only` | — | Emit only Prisma models (compose via `prismaSchemaFolder`). |
| `-o, --output <path>` | stdout | Write to a file. |

The output mirrors the deployed DDL, so the subgraph owns the schema: run
`prisma db pull` / `drizzle-kit pull` to verify (it should be a no-op), never
`prisma migrate` / `drizzle-kit push`. Tables are processor-written — query them
read-only. `uint`→`Decimal`/`numeric` and the `BigInt` id need `.toString()` for
JSON. Relations require `relations` metadata on the subgraph schema.

Example: `sl subgraphs codegen subgraphs/dex.ts --target prisma -o prisma/schema.prisma`

---

## Subscriptions

Manage subgraph table subscriptions (webhook deliveries). Alias: `subs`. All subcommands accept `--service-key <key>` (overrides `SL_API_KEY`) and `--base-url <url>` (overrides `SL_API_URL`). Without those, the CLI resolves credentials from the active project via `sl login`.

Subscription references (`<idOrName>`) accept the subscription UUID or its name. Ambiguous names error out — use the ID.

Subscriptions come in two kinds: **subgraph** (fires on subgraph table rows) and **chain** (fires on raw chain events, no subgraph). `create` here only makes subgraph subscriptions; all other subcommands (`list`, `get`, `update`, `pause`, `resume`, `delete`, `deliveries`, etc.) operate on both kinds.

### sl subscriptions create

Scaffold a subscription receiver for a runtime and provision the subscription via the API. **Creates subgraph subscriptions only** (fires on rows written to a subgraph table — `--subgraph` + `--table`). To create a **chain subscription** (raw chain events, no subgraph — `triggers`), use the SDK (`sl.subscriptions.create({ triggers: [...] })`, see `references/sdk.md`), REST (`POST /api/subscriptions` with `triggers`), or MCP (`subscriptions_create` with `triggers`). The CLI has no `--triggers` flag.

Usage: `sl subscriptions create <name>`

| Flag | Description |
| --- | --- |
| `-r, --runtime <runtime>` | `inngest` \| `trigger` \| `cloudflare` \| `node`. Prompts if omitted. |
| `-s, --subgraph <name>` | Subgraph to subscribe to. Prompts if omitted. |
| `-t, --table <name>` | Table to subscribe to. Prompts if omitted. |
| `-u, --url <url>` | Webhook URL. Prompts if omitted. Must be http/https. |
| `--auth-token <token>` | Bearer token for receiver-side auth. |
| `--filter <kv...>` | Repeatable. `key=value` with `.eq/.neq/.gt/.gte/.lt/.lte` suffixes. |
| `--service-key <key>` | `SL_API_KEY` override. |
| `--base-url <url>` | `SL_API_URL` override. |
| `--skip-api` | Copy template only; do NOT create the subscription via API. |
| `--no-scaffold` | Skip the local runtime template directory (webhook-only setups — provisions subscription only). |

Behavior:
1. Validates target subgraph + table + filter via API (skipped with `--skip-api`).
2. Copies template into `./<name>/` (skipped with `--no-scaffold`).
3. POSTs `/api/subscriptions` to create the subscription with the matching `format`/`runtime`.
4. Writes returned `SIGNING_SECRET` into `./<name>/.env` (or prints if `--no-scaffold`).

`format` is derived from `runtime`: `inngest`→`inngest`, `trigger`→`trigger`, `cloudflare`→`cloudflare`, `node`→`standard-webhooks`.

Example: `sl subscriptions create my-sub -r node -s my-watcher -t transfers -u https://app.example/webhook`

Webhook-only (no scaffold): `sl subscriptions create notify --no-scaffold -r node -s my-watcher -t transfers -u https://app.example/webhook`

### sl subscriptions list

List subscriptions (alias: `ls`).

Usage: `sl subscriptions list`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |
| `--service-key <key>` | `SL_API_KEY` override. |
| `--base-url <url>` | `SL_API_URL` override. |

### sl subscriptions get

Show subscription details.

Usage: `sl subscriptions get <idOrName>`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |
| `--service-key <key>` / `--base-url <url>` | API auth overrides. |

### sl subscriptions update

Update subscription config (any subset of fields).

Usage: `sl subscriptions update <idOrName>`

| Flag | Description |
| --- | --- |
| `--name <name>` | Rename subscription. |
| `--url <url>` | Webhook URL. |
| `--auth-token <token>` | Set bearer-token auth config. |
| `--format <format>` | `standard-webhooks` \| `inngest` \| `trigger` \| `cloudflare` \| `cloudevents` \| `raw`. |
| `--runtime <runtime>` | `inngest` \| `trigger` \| `cloudflare` \| `node` \| `none` (also accepts `null`). |
| `--filter <kv...>` | Repeatable. `key=value` with `.eq/.neq/.gt/.gte/.lt/.lte` suffixes. |
| `--clear-filter` | Replace filter with `{}`. Mutually exclusive with `--filter`. |
| `--max-retries <n>` | Max delivery retries (integer ≥ 0). |
| `--timeout-ms <n>` | Delivery timeout (ms, ≥ 100). |
| `--concurrency <n>` | Per-subscription delivery concurrency (≥ 1). |
| `--json` | Output as JSON. |
| `--service-key <key>` / `--base-url <url>` | API auth overrides. |

If `--filter` is set, the new filter is validated against the target subgraph table before applying.

### sl subscriptions pause

Pause a subscription.

Usage: `sl subscriptions pause <idOrName>`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |
| `--service-key <key>` / `--base-url <url>` | API auth overrides. |

### sl subscriptions resume

Resume a subscription.

Usage: `sl subscriptions resume <idOrName>`

Same flags as `pause`.

### sl subscriptions delete

**DESTRUCTIVE.** Delete a subscription (pending outbox rows are removed).

Usage: `sl subscriptions delete <idOrName>`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |
| `--json` | Output as JSON. |
| `--service-key <key>` / `--base-url <url>` | API auth overrides. |

Refuses prompt without a TTY. 404 is treated as "already deleted" (idempotent).

### sl subscriptions rotate-secret

**DESTRUCTIVE.** Rotate the signing secret. Existing receivers using the old secret will fail verification.

Usage: `sl subscriptions rotate-secret <idOrName>`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |
| `--json` | Output as JSON. |
| `--service-key <key>` / `--base-url <url>` | API auth overrides. |

Prints the new secret to stdout. Capture immediately.

### sl subscriptions deliveries

Show recent delivery attempts.

Usage: `sl subscriptions deliveries <idOrName>`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |
| `--service-key <key>` / `--base-url <url>` | API auth overrides. |

### sl subscriptions dead

Show dead-letter outbox rows (deliveries past max retries).

Usage: `sl subscriptions dead <idOrName>`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |
| `--service-key <key>` / `--base-url <url>` | API auth overrides. |

### sl subscriptions requeue

**DESTRUCTIVE.** Requeue one dead-letter row.

Usage: `sl subscriptions requeue <idOrName> <outboxId>`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |
| `--json` | Output as JSON. |
| `--service-key <key>` / `--base-url <url>` | API auth overrides. |

### sl subscriptions replay

**DESTRUCTIVE.** Replay a block range (re-emits matching rows to the receiver).

Usage: `sl subscriptions replay <idOrName> --from-block <n> --to-block <n>`

| Flag | Required | Description |
| --- | --- | --- |
| `--from-block <n>` | yes | Start block (integer ≥ 0). |
| `--to-block <n>` | yes | End block (must be ≥ from). |
| `-y, --yes` | no | Skip confirmation. |
| `--json` | no | Output as JSON. |
| `--service-key <key>` / `--base-url <url>` | no | API auth overrides. |

Returns `replayId`, `enqueuedCount`, `scannedCount`.

### sl subscriptions doctor

Diagnose subscription health (delivery stats, dead rows, linked subgraph sync, hints).

Usage: `sl subscriptions doctor <idOrName>`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |
| `--service-key <key>` / `--base-url <url>` | API auth overrides. |

### sl subscriptions test

Build (and optionally POST) a signed Standard-Webhooks fixture.

Usage: `sl subscriptions test <idOrName>`

| Flag | Description |
| --- | --- |
| `--signing-secret <secret>` | Signing secret override (otherwise reads `SIGNING_SECRET`). Required if env unset. |
| `--post` | Actually POST the fixture to the subscription URL. |
| `--json` | Output as JSON (fixture + post result). |
| `--service-key <key>` / `--base-url <url>` | API auth overrides. |

Fetches a recent row from the target table (falls back to synthetic row by column type), signs body with the secret, prints body / headers / curl invocation. With `--post`, POSTs and prints the receiver's status + first 2000 chars of body.

Example: `SIGNING_SECRET=whsec_… sl subscriptions test my-sub --post`

---

## Index

Query the decoded L2 layer (`/v1/index`). Anonymous reads are allowed, and a
**free-tier key works too** (free-tier rate limit; a minted free key is never
slower than anonymous). The key is optional — passed through from `SL_API_KEY`
when present. Free/anonymous reads cover the recent 24h window; older history
needs pay-as-you-go credits (`POST /api/billing/topup`) or a paid plan, else a
read below the window returns `402 UPGRADE_REQUIRED`.

- `sl index ft-transfers [--contract-id] [--sender] [--recipient] [--from-height] [--to-height] [--cursor] [--limit] [--json]`
- `sl index nft-transfers [… --asset-identifier]`
- `sl index events --event-type <type> [filters…]` — generic decoded events (stx_*, ft/nft mint/burn, print, …)
- `sl index contract-calls [--function-name] [--sender] [filters…]`

```bash
sl index ft-transfers --recipient SP… --limit 20
sl index events --event-type print --contract-id SP….dao --limit 10
```

Mirrors `sl.index.{ftTransfers,nftTransfers,events,contractCalls}` in the SDK.

## Streams

Read raw chain events from Streams at `api.secondlayer.tools`. **Requires `SL_API_KEY`** (issue at https://www.secondlayer.tools/platform/api-keys, product: Streams). Base URL defaults to `https://api.secondlayer.tools`; override via `SL_API_URL`.

Valid event types: `stx_transfer`, `stx_mint`, `stx_burn`, `stx_lock`, `ft_transfer`, `ft_mint`, `ft_burn`, `nft_transfer`, `nft_mint`, `nft_burn`, `print`.

Cursor format: `block_height:event_index`.

### sl streams tip

Print current canonical tip.

Usage: `sl streams tip`

No flags. GET `/v1/streams/tip`.

### sl streams events

List events (cursor-paginated; one page per call).

Usage: `sl streams events`

| Flag | Default | Description |
| --- | --- | --- |
| `--types <types>` | — | Comma-separated event types. |
| `--contract-id <id>` | — | Filter to a single contract identifier. |
| `--cursor <cursor>` | — | Start cursor (`block_height:event_index`). |
| `--from-block <n>` | — | Filter to blocks ≥ n. |
| `--to-block <n>` | — | Filter to blocks ≤ n. |
| `--limit <n>` | `100` | Page size (1-1000). |

Prints full envelope (events + `next_cursor`) as JSON.

Example: `sl streams events --types ft_transfer --contract-id SP3...sbtc-token --limit 500`

### sl streams consume

Long-running pull from a cursor; emits one event per line (jsonl) until SIGINT or `--max-pages`.

Usage: `sl streams consume`

| Flag | Default | Description |
| --- | --- | --- |
| `--types <types>` | — | Comma-separated event types. |
| `--contract-id <id>` | — | Filter to a single contract identifier. |
| `--cursor <cursor>` | — | Start cursor. |
| `--batch-size <n>` | `100` | Events per batch (1-1000). |
| `--max-pages <n>` | (∞) | Stop after N pages. |

Events go to stdout (jsonl); `next_cursor` checkpoints go to stderr as `# next_cursor=...`.

Example: `sl streams consume --types print --contract-id SP3...my-contract --cursor 12345:0 > events.jsonl`

### sl streams reorgs

List recent reorgs (cursor-paginated).

Usage: `sl streams reorgs --since <cursor>`

| Flag | Default | Required | Description |
| --- | --- | --- | --- |
| `--since <cursor>` | — | yes | Start cursor. |
| `--limit <n>` | `100` | no | Page size. |

### sl streams canonical

Canonical block metadata at a given height.

Usage: `sl streams canonical <height>`

No flags.

Example: `sl streams canonical 150000`

### sl streams pull

Download finalized bulk parquet dumps locally and verify each file's sha256 against the manifest. Dumps are **public** — no API key needed; pass `--dumps-url` or set `SL_STREAMS_DUMPS_URL`.

Usage: `sl streams pull --to <dir>`

| Flag | Default | Description |
| --- | --- | --- |
| `--to <dir>` | — | Output directory for downloaded parquet files. |
| `--dumps-url <url>` | `SL_STREAMS_DUMPS_URL` | Public bulk-dump bucket base URL. |
| `--from-block <n>` | — | Only pull dumps covering blocks ≥ n. |
| `--to-block <n>` | — | Only pull dumps covering blocks ≤ n. |

Example: `sl streams pull --to ./dumps --dumps-url https://dumps.secondlayer.tools --from-block 100000 --to-block 200000`

---

## Local

Manage local development environment. All `local` subcommands require `network=local` (set via `--network local` or `sl config set network local`).

### sl local up

Start all local dev services (API, indexer, worker, subgraphs).

Usage: `sl local up`

| Flag | Default | Description |
| --- | --- | --- |
| `--indexer-port <port>` | `3700` | Indexer port. |
| `--api-port <port>` | `3800` | API port. |
| `--no-worker` | (worker on) | Skip worker service. |
| `--stacks-node` | false | Use port 3701 for indexer (avoids conflict with `stacks-blockchain-api`). |
| `-f, --foreground` | false | Run in foreground (blocking). Default is background. |

### sl local down

Stop all local dev services.

Usage: `sl local down`

No flags.

### sl local restart

Restart dev services (preserves Docker containers).

Usage: `sl local restart`

No flags.

### sl local status

Show local environment status (dev services + node summary if running).

Usage: `sl local status`

No flags.

### sl local logs

View local service logs (dev + node).

Usage: `sl local logs`

| Flag | Default | Description |
| --- | --- | --- |
| `-s, --service <name>` | (all) | Filter by service: `api`, `indexer`, `worker`, `subgraphs`, `node`. |
| `-f, --follow` | false | Follow log output. |
| `-n, --lines <n>` | `50` | Number of lines to show. |
| `-q, --quiet` | false | Filter out common noise. |

### sl local node setup

Interactive setup wizard for Stacks node.

Usage: `sl local node setup`

No flags.

### sl local node start

Start the Stacks node.

Usage: `sl local node start`

| Flag | Description |
| --- | --- |
| `-p, --path <path>` | Path to `stacks-blockchain-docker` (overrides config). |
| `--with-indexer` | Also start indexer. |

### sl local node stop

Stop the Stacks node.

Usage: `sl local node stop`

| Flag | Description |
| --- | --- |
| `-p, --path <path>` | Path to `stacks-blockchain-docker`. |
| `-f, --force` | Skip confirmation. |
| `--wait` | Wait for in-flight work to drain first. |

### sl local node restart

Restart the Stacks node (stop then start). Same flags as `stop`.

Usage: `sl local node restart`

### sl local node status

Show Stacks node status.

Usage: `sl local node status`

| Flag | Description |
| --- | --- |
| `-p, --path <path>` | Path override. |
| `--json` | Output as JSON. |

### sl local node config

Show node configuration.

Usage: `sl local node config`

| Flag | Description |
| --- | --- |
| `--edit` | Run setup wizard interactively. |

### sl local node config-check

Show events-observer configuration block to paste into `Config.toml`.

Usage: `sl local node config-check`

| Flag | Default | Description |
| --- | --- | --- |
| `--indexer-port <port>` | `3700` | Indexer port to display. |

### sl local node logs

Shortcut for `sl local logs --service node`.

Usage: `sl local node logs`

| Flag | Default | Description |
| --- | --- | --- |
| `-f, --follow` | false | Follow log output. |
| `-n, --lines <n>` | `50` | Number of lines. |
| `-q, --quiet` | false | Filter noise. |

---

## Devnet

Run Secondlayer services against a local [Clarinet](https://docs.hiro.so/stacks/clarinet) devnet. Unlike `sl local up` (which runs the services from source for contributors), `sl local up --devnet` pulls the published OSS Docker images, so it works for any developer with a clarinet project — no repo checkout required. Requires Docker (Docker Desktop or OrbStack) and `clarinet` installed.

### sl local up --devnet

Point your clarinet project's devnet at a local Secondlayer stack and start it. Detects the nearest `Clarinet.toml`, adds the indexer to `settings/Devnet.toml`'s `stacks_node_events_observers` (idempotent; preserves your comments), writes `.secondlayer/docker-compose.yml`, and runs `docker compose up -d`.

Usage: `sl local up --devnet`

| Flag | Default | Description |
| --- | --- | --- |
| `--project <dir>` | nearest `Clarinet.toml` | Clarinet project directory. |
| `--image-tag <tag>` | `latest` | Published OSS image tag to run. |
| `--owner <owner>` | `ryanwaits` | ghcr image owner (namespace) to pull from. |
| `--no-up` | (starts docker) | Patch config + write compose without starting Docker. |

Then run your normal `clarinet devnet start` — deployed contracts and their events stream into the local indexer (api at `http://localhost:3800`, indexer at `http://localhost:3700`). Deploy a subgraph against it with:

```bash
SL_API_URL=http://localhost:3800 SL_API_KEY=dummy sl subgraphs deploy ./subgraph.ts
```

To see rows appear you need a real contract-call transaction — `clarinet console` runs against simnet, not your running devnet, so it won't broadcast on-chain. Fire one with `@stacks/transactions` (uses the well-known devnet deployer key):

```ts
import {
	broadcastTransaction,
	getAddressFromPrivateKey,
	makeContractCall,
} from "@stacks/transactions";

const key =
	"753b7cc01a1a2e86221266a154af739463fce51219d97e4f856cd7200c3bd2a601"; // devnet deployer
const sender = getAddressFromPrivateKey(key, "testnet");
const { nonce } = await fetch(
	`http://localhost:3999/v2/accounts/${sender}?proof=0`,
).then((r) => r.json());

const tx = await makeContractCall({
	contractAddress: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
	contractName: "counter",
	functionName: "increment",
	functionArgs: [],
	senderKey: key,
	network: "devnet",
	fee: 3000n,
	nonce: BigInt(nonce),
});
console.log(await broadcastTransaction({ transaction: tx, network: "devnet" }));
```

The row shows up at `GET http://localhost:3800/v1/subgraphs/<name>/<table>` within ~5s.

### sl local down --devnet

Stop the local Secondlayer stack started by `sl local up --devnet`.

Usage: `sl local down --devnet`

| Flag | Default | Description |
| --- | --- | --- |
| `--project <dir>` | nearest `Clarinet.toml` | Clarinet project directory. |
| `--purge` | false | Also remove volumes (wipes the local index — use when restarting your devnet from scratch). |

### sl devnet status

Snapshot of the local stack: service health, ingest tip/lag, deployed subgraphs (status, block, tables, row counts), and a recent-activity table built from the subgraph rows. Node-native; reads `SL_API_URL` (default `http://localhost:3800`) and `INDEXER_URL` (default `http://localhost:3700`).

Usage: `sl devnet status`

| Flag | Default | Description |
| --- | --- | --- |
| `-w, --watch` | false | Refresh every 2s until Ctrl-C. |
| `-n, --limit <n>` | `12` | Recent activity rows to show. |

### sl devnet logs

Tail the stack's container logs.

Usage: `sl devnet logs [service]` — `service` is optional, one of `indexer`, `api`, `subgraph-processor`, `postgres`.

| Flag | Default | Description |
| --- | --- | --- |
| `--project <dir>` | nearest `Clarinet.toml` | Clarinet project directory. |
| `-f, --follow` | false | Follow log output. |
| `-n, --lines <n>` | `200` | Lines to show from the end of each log. |

### Testing subscriptions locally

`sl local up --devnet` starts the subscription emitter and configures the stack to deliver webhooks locally: it shares one secrets key across the api and subgraph-processor (so the emitter can decrypt a subscription's signing secret) and sets `SECONDLAYER_ALLOW_PRIVATE_EGRESS` (so webhooks can reach a localhost receiver). To test:

1. Deploy a subgraph (`sl subgraphs deploy ./subgraph.ts`), then start a local chain with `clarinet devnet start`.
2. Create a subscription on the local API, pointing at a webhook receiver on your host. The emitter runs in a container, so use `host.docker.internal` instead of `localhost`:

```bash
curl -X POST http://localhost:3800/api/subscriptions \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-hook","subgraphName":"my-app","tableName":"counter_calls","url":"http://host.docker.internal:9999/hook"}'
```

3. Fire a contract call. The matched row is delivered to your receiver as a signed Standard-Webhooks payload; inspect attempts with `sl subscriptions deliveries my-hook`.

---

## Local DB

Inspect the local indexer Postgres database. Nested under `local` (requires `network=local`). Defaults `DATABASE_URL` to `postgres://postgres:postgres@localhost:5432/secondlayer_dev` if unset.

### sl local db (overview)

Show overview (counts + latest block).

Usage: `sl local db`

No flags.

### sl local db blocks

Show recent blocks.

Usage: `sl local db blocks`

| Flag | Default | Description |
| --- | --- | --- |
| `--limit <n>` | `10` | Number of rows. |
| `--json` | false | Output as JSON. |

### sl local db txs

Show recent transactions.

Usage: `sl local db txs`

Same flags as `blocks`.

### sl local db events

Show recent events.

Usage: `sl local db events`

Same flags as `blocks`.

### sl local db gaps

Show gaps in indexed block data.

Usage: `sl local db gaps`

| Flag | Default | Description |
| --- | --- | --- |
| `--limit <n>` | `50` | Number of gaps to show. |
| `--json` | false | Output as JSON. |

### sl local db truncate

**DESTRUCTIVE.** Truncate all indexed data (`blocks`, `transactions`, `events`, `index_progress`). Subgraph configs preserved.

Usage: `sl local db truncate`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |

### sl local db resync

**DESTRUCTIVE.** Reset DB and restart indexer for fresh sync.

Usage: `sl local db resync`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |
| `--backfill` | After reset, fetch all blocks from node and POST them to `${INDEXER_URL}/new_block` (concurrency 5). |

---

## Account

Manage your public account profile.

### sl account get

Show your account profile.

Usage: `sl account get [--json]`

### sl account update

Update your public profile.

Usage: `sl account update`

| Flag | Description |
| --- | --- |
| `--name <name>` | Set display name. |
| `--bio <bio>` | Set bio. |
| `--slug <slug>` | Set public URL slug. |
| `--json` | Output as JSON. |

---

### sl account billing

Show your current plan, Stripe subscription, trial, and discounts.

Usage: `sl account billing`

No flags. GETs `/api/billing/status`.

---

## Config

Manage CLI configuration (`~/.config/secondlayer/config.json` or platform equivalent — see `sl config get` output for actual path).

### sl config get

Show current configuration.

Usage: `sl config get`

No flags. Prints config tree; in local mode also prints node + ports + database sections.

### sl config set

Set a configuration value. Supports dot notation: `ports.api`, `node.network`, `database.url`, etc.

Usage: `sl config set <key> <value>`

| Flag | Description |
| --- | --- |
| `--no-validate` | Skip connection validation for `database.url`. |

Validates `database.url` by attempting a `SELECT 1` Postgres query unless `--no-validate`.

Example: `sl config set network local`

### sl config reset

Reset configuration to defaults.

Usage: `sl config reset`

No flags.

### sl config delete

Clear all configuration (delete config file).

Usage: `sl config delete`

No flags.

---

## Status

### sl status

Show system status (top-level).

Usage: `sl status`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |

GETs `/status` from the platform. Prints DB status, per-network index progress with chain-tip progress bar, gap summary, and active subgraph count. On failure: in local mode suggests `sl local up`; in hosted mode reports connectivity issue.

---

## Doctor

### sl doctor

Run diagnostics on the full stack.

Usage: `sl doctor`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |

Local mode: checks node (RPC, peers, version, chain ID), Docker containers, dev services, Postgres, config paths, disk space, log sizes.

Hosted mode: checks platform API reachability, session auth, account info, index progress.

---

## Contracts generate

### sl contracts generate

Generate TypeScript interfaces from Clarity contracts. Alias: `contracts gen`.

Usage: `sl contracts generate [files...]`

| Flag | Description |
| --- | --- |
| `-c, --config <path>` | Path to config file (default `secondlayer.config.ts`). |
| `-o, --output <path>` | Output file path. **Required** when using direct file/contract inputs (not config-based). |
| `-k, --api-key <key>` | Stacks node API key for direct RPC. Falls back to `STACKS_NODE_API_KEY` / `HIRO_API_KEY`. |
| `-w, --watch` | Watch for changes. |

Accepts `.clar` file paths, glob patterns, or deployed contract IDs (`SP…/ST…/SM…/SN….<name>`). When invoked with no positional args, reads `secondlayer.config.ts`.

Examples:
- `sl contracts generate ./contracts/*.clar -o ./src/generated.ts`
- `sl contracts generate SP2C2YFP12AJZB1M6DY7SF9A3PRHWKGYGVWQKW3.my-token -o ./src/generated.ts`
- `sl contracts generate` (uses config file)

### sl init

Initialize a new `secondlayer.config.ts` file.

Usage: `sl init`

No flags. If `Clarinet.toml` exists in cwd, generates a config with the `clarinet()` plugin pre-wired. Errors if config already exists.
