# Secondlayer CLI (`sl`) Reference

The `sl` binary (alias `secondlayer`) is the official CLI for Secondlayer — dedicated Stacks indexing + real-time subgraphs. Install globally with `bun add -g @secondlayer/cli`. The binary is named `secondlayer`; `sl` is a Commander alias for the same entry point. All commands accept a global `--network <network>` flag (`local`, `testnet`, `mainnet`) which is equivalent to setting `STACKS_NETWORK` before the call.

## Global flags

| Flag | Description |
| --- | --- |
| `--network <network>` | Override network for this invocation (sets `STACKS_NETWORK`). Values: `local`, `testnet`, `mainnet`. |
| `--version` | Print CLI version. |
| `--help` | Show help. |

## Environment variables

| Var | Used by | Purpose |
| --- | --- | --- |
| `SL_API_URL` | subscriptions, create | Override tenant API base URL. |
| `SL_SERVICE_KEY` | subscriptions, create | Service key for tenant API auth (write scope). |
| `SL_STREAMS_API_KEY` | streams | API key for `api.secondlayer.tools` Streams (issued in dashboard). |
| `SL_PLATFORM_API_URL` | doctor (hosted) | Override platform API URL (default `https://api.secondlayer.tools`). |
| `HIRO_API_KEY` / `STACKS_NODE_API_KEY` | subgraphs scaffold, generate | API key passed to Hiro Stacks RPC when fetching contract ABIs. |
| `SIGNING_SECRET` | subscriptions test | Standard-Webhooks signing secret used to sign test fixtures. |
| `STACKS_NETWORK` | global | Network override (set by `--network`). |
| `DATABASE_URL` | db | Postgres URL for local indexer DB; defaults to `postgres://postgres:postgres@localhost:5432/secondlayer_dev`. |
| `INDEXER_URL` | db resync --backfill | Local indexer URL; defaults to `http://localhost:<config.ports.indexer>`. |
| `DEBUG` | generate | When set, prints stack traces on failure. |

## Table of contents

- [Auth](#auth) — `login`, `logout`, `whoami`
- [Project](#project) — `project create|list|use|current`
- [Subgraphs](#subgraphs) — `new`, `dev`, `deploy`, `list`, `status`, `spec`, `inspect`, `reindex`, `backfill`, `stop`, `gaps`, `query`, `delete`, `scaffold`, `client`, `codegen`
- [Subscriptions](#subscriptions) — `list`, `get`, `update`, `pause`, `resume`, `delete`, `rotate-secret`, `deliveries`, `dead`, `requeue`, `replay`, `doctor`, `test`
- [Streams](#streams) — `tip`, `events`, `consume`, `reorgs`, `canonical`
- [Create](#create) — `create subscription`
- [Local](#local) — `local start|stop|restart|status|logs`, `local node …`
- [Devnet](#devnet) — `devnet connect|down` (run services against a Clarinet devnet)
- [Stack](#stack) — `stack start|stop|restart`
- [DB](#db) — `db blocks|txs|events|gaps|reset|resync`
- [Account](#account) — `account profile`
- [Billing](#billing) — `billing status`
- [Config](#config) — `config show|set|reset|clear`
- [Status](#status) — top-level `status`
- [Doctor](#doctor) — top-level `doctor`
- [Generate](#generate) — top-level `generate`, `init`

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

Show current authenticated account + active project.

Usage: `sl whoami`

No flags. Reads local session, calls `/api/accounts/me`, and prints email, plan, and the active project (from `./.secondlayer/project`, walking up the directory tree, falling back to global `defaultProject`).

---

## Project

Account-scoped project management. Each project maps 1:1 to a dedicated tenant. Binding a project to a directory writes `./.secondlayer/project` (recommend adding `.secondlayer/` to `.gitignore` — it's account-personal).

### sl project create

Create a new project.

Usage: `sl project create [name]`

| Flag | Description |
| --- | --- |
| `--slug <slug>` | Explicit URL slug (defaults to slugified name). Must be 2-63 chars, `[a-z0-9-]`, start/end with alphanumeric. |

Prompts for a name if not provided. POSTs `/api/projects`. First project becomes the global `defaultProject`.

Example: `sl project create "My Watcher" --slug my-watcher`

### sl project list

List projects in your account.

Usage: `sl project list`

No flags. GETs `/api/projects`. Marks the active project with `*`.

### sl project use

Bind this directory to a project (writes `./.secondlayer/project`).

Usage: `sl project use <slug>`

No flags. Verifies project exists via `GET /api/projects/:slug` before writing the binding file.

Example: `sl project use my-watcher`

### sl project current

Show the active project for this directory.

Usage: `sl project current`

No flags. Prints the active slug and resolution source (`.secondlayer/project` in cwd / parent dir / global default).

---

## Subgraphs

Manage materialized subgraphs. Most subcommands hit the active tenant's API (resolved via session + active project) and require `sl login` unless `--service-key`/`SL_SERVICE_KEY` is set. Local deploys (`network=local`) skip auth and write to the local Postgres dev DB.

### sl subgraphs new

Scaffold a new subgraph definition file at `./subgraphs/<name>.ts`.

Usage: `sl subgraphs new <name>`

| Flag | Default | Description |
| --- | --- | --- |
| `--template <slug>` | `basic` | Foundation Dataset starter. One of: `basic`, `sip-010-balances`, `sbtc-flows`, `pox-stacking`, `bns-names`. |

Writes to `subgraphs/<name>.ts` (creates `subgraphs/` if missing). Errors if the file already exists.

Example: `sl subgraphs new my-watcher --template sip-010-balances`

### sl subgraphs dev

Watch a subgraph file and auto-redeploy on change (LOCAL ONLY — requires `network=local`).

Usage: `sl subgraphs dev <file>`

No flags. Deploys once, then re-deploys on file changes (300ms debounce). Reads/writes directly to local Postgres via `@secondlayer/shared/db`. Ctrl-C to stop.

Example: `sl subgraphs dev subgraphs/my-watcher.ts`

### sl subgraphs deploy

Deploy a subgraph definition file.

Usage: `sl subgraphs deploy <file>`

| Flag | Default | Description |
| --- | --- | --- |
| `--start-block <n>` | (from definition) | Override definition's `startBlock` for this deploy (nonneg integer). |
| `--dry-run` | false | Validate and preview without writing. |
| `--preview` | false | Alias for `--dry-run`. |
| `--force` | false | Skip confirmation prompt for reindex operations (DROP + reindex). |
| `--strict` | false | Run `bunx tsc --noEmit` on handler before deploy. |

Remote deploy (non-local): bundles handler via `@secondlayer/bundler`, POSTs to tenant API. Server returns one of `unchanged`, `handler_updated`, `created`, `updated`, `reindexed`. **Destructive (`reindexed`) deploys prompt for confirmation** unless `--force` is set. Local deploy: writes to local DB via `deploySchema()`.

Example: `sl subgraphs deploy subgraphs/my-watcher.ts --start-block 100000`

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

Output API documentation for a deployed subgraph.

Usage: `sl subgraphs spec <name>`

| Flag | Default | Description |
| --- | --- | --- |
| `--format <format>` | `openapi` | One of: `openapi`, `agent`, `markdown`. |
| `-o, --output <path>` | (stdout) | Write to file instead of stdout. |
| `--server <url>` | (from API) | Override server URL in generated docs. |

Example: `sl subgraphs spec my-watcher --format agent -o ./docs/my-watcher.json`

### sl subgraphs inspect

Output API documentation for a LOCAL subgraph file (no API call).

Usage: `sl subgraphs inspect <file>`

| Flag | Default | Description |
| --- | --- | --- |
| `--format <format>` | `agent` | One of: `openapi`, `agent`, `markdown`. |
| `-o, --output <path>` | (stdout) | Write to file. |
| `--server <url>` | — | Override server URL in generated docs. |

Bundles the file in-process and emits spec without touching any server.

### sl subgraphs reindex

**DESTRUCTIVE.** Reindex a subgraph from historical blocks (drops existing rows in range, reprocesses).

Usage: `sl subgraphs reindex <name>`

| Flag | Description |
| --- | --- |
| `--from <block>` | Start block height (integer). |
| `--to <block>` | End block height (integer). |
| `-y, --yes` | Skip the confirmation prompt. |

Prompts for confirmation by default (default answer: **no**). Non-TTY environments must pass `-y` or the command exits non-zero. Added in `@secondlayer/cli` 5.5.0; older versions ran silently.

### sl subgraphs backfill

Backfill a block range without dropping existing data.

Usage: `sl subgraphs backfill <name> --from <block> --to <block>`

| Flag | Required | Description |
| --- | --- | --- |
| `--from <block>` | yes | Start block height. |
| `--to <block>` | yes | End block height. |

### sl subgraphs stop

Stop a running reindex or backfill operation.

Usage: `sl subgraphs stop <name>`

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

Manage subgraph table subscriptions (webhook deliveries). Alias: `subs`. All subcommands accept `--service-key <key>` (overrides `SL_SERVICE_KEY`) and `--base-url <url>` (overrides `SL_API_URL`). Without those, the CLI resolves credentials from the active project via `sl login`.

Subscription references (`<idOrName>`) accept the subscription UUID or its name. Ambiguous names error out — use the ID.

### sl subscriptions list

List subscriptions (alias: `ls`).

Usage: `sl subscriptions list`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |
| `--service-key <key>` | `SL_SERVICE_KEY` override. |
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

## Datasets

Query Foundation Datasets (sBTC, BNS, PoX-4, STX transfers). Public reads — no
API key. Base URL via `SL_API_URL` (default `https://api.secondlayer.tools`).

- `sl datasets list` — dataset catalog + freshness.
- `sl datasets query <dataset> [--filter k=v…] [--limit n] [--cursor c] [--json]`
  — cursor-paginated query. Datasets: `stx-transfers`, `sbtc-events`,
  `sbtc-token-events`, `pox-4-calls`, `bns-events`, `bns-namespace-events`,
  `bns-marketplace-events`. `--filter` keys are the dataset's documented params.

```bash
# all stacking activity for an address (any role: caller / stacker / delegate)
sl datasets query pox-4-calls --filter address=SP… --limit 20
sl datasets query sbtc-events --filter topic=withdrawal-create --limit 5
```

The SDK exposes the same surface (`new Datasets({...})` → `.pox4Calls.list/walk`,
`.bnsResolve(fqn)`, `.networkHealth()`); see `sdk.md`.

## Streams

Read raw chain events from Streams at `api.secondlayer.tools`. **Requires `SL_STREAMS_API_KEY`** (issue at https://www.secondlayer.tools/platform/api-keys, product: Streams). Base URL defaults to `https://api.secondlayer.tools`; override via `SL_API_URL`.

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
| `--from-height <n>` | — | Filter to blocks ≥ n. |
| `--to-height <n>` | — | Filter to blocks ≤ n. |
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

---

## Create

Scaffold new resources.

### sl create subscription

Scaffold a subscription receiver for a runtime and provision the subscription via the API.

Usage: `sl create subscription <name>`

| Flag | Description |
| --- | --- |
| `-r, --runtime <runtime>` | `inngest` \| `trigger` \| `cloudflare` \| `node`. Prompts if omitted. |
| `-s, --subgraph <name>` | Subgraph to subscribe to. Prompts if omitted. |
| `-t, --table <name>` | Table to subscribe to. Prompts if omitted. |
| `-u, --url <url>` | Webhook URL. Prompts if omitted. Must be http/https. |
| `--auth-token <token>` | Bearer token for receiver-side auth. |
| `--filter <kv...>` | Repeatable. `key=value` with `.eq/.neq/.gt/.gte/.lt/.lte` suffixes. |
| `--service-key <key>` | `SL_SERVICE_KEY` override. |
| `--base-url <url>` | `SL_API_URL` override. |
| `--skip-api` | Copy template only; do NOT create the subscription via API. |
| `--no-scaffold` | Skip the local runtime template directory (webhook-only setups — provisions subscription only). |

Behavior:
1. Validates target subgraph + table + filter via API (skipped with `--skip-api`).
2. Copies template into `./<name>/` (skipped with `--no-scaffold`).
3. POSTs `/api/subscriptions` to create the subscription with the matching `format`/`runtime`.
4. Writes returned `SIGNING_SECRET` into `./<name>/.env` (or prints if `--no-scaffold`).

`format` is derived from `runtime`: `inngest`→`inngest`, `trigger`→`trigger`, `cloudflare`→`cloudflare`, `node`→`standard-webhooks`.

Example: `sl create subscription my-sub -r node -s my-watcher -t transfers -u https://app.example/webhook`

Webhook-only (no scaffold): `sl create subscription notify --no-scaffold -r node -s my-watcher -t transfers -u https://app.example/webhook`

---

## Local

Manage local development environment. All `local` subcommands require `network=local` (set via `--network local` or `sl config set network local`).

### sl local start

Start all local dev services (API, indexer, worker, subgraphs).

Usage: `sl local start`

| Flag | Default | Description |
| --- | --- | --- |
| `--indexer-port <port>` | `3700` | Indexer port. |
| `--api-port <port>` | `3800` | API port. |
| `--no-worker` | (worker on) | Skip worker service. |
| `--stacks-node` | false | Use port 3701 for indexer (avoids conflict with `stacks-blockchain-api`). |
| `-f, --foreground` | false | Run in foreground (blocking). Default is background. |

### sl local stop

Stop all local dev services.

Usage: `sl local stop`

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

Run Secondlayer services against a local [Clarinet](https://docs.hiro.so/stacks/clarinet) devnet. Unlike `sl local` (which runs the services from source for contributors), `sl devnet` pulls the published OSS Docker images, so it works for any developer with a clarinet project — no repo checkout required. Requires Docker (Docker Desktop or OrbStack) and `clarinet` installed.

### sl devnet connect

Point your clarinet project's devnet at a local Secondlayer stack and start it. Detects the nearest `Clarinet.toml`, adds the indexer to `settings/Devnet.toml`'s `stacks_node_events_observers` (idempotent; preserves your comments), writes `.secondlayer/docker-compose.yml`, and runs `docker compose up -d`.

Usage: `sl devnet connect`

| Flag | Default | Description |
| --- | --- | --- |
| `--project <dir>` | nearest `Clarinet.toml` | Clarinet project directory. |
| `--image-tag <tag>` | `latest` | Published OSS image tag to run. |
| `--owner <owner>` | `ryanwaits` | ghcr image owner (namespace) to pull from. |
| `--no-up` | (starts docker) | Patch config + write compose without starting Docker. |

Then run your normal `clarinet devnet start` — deployed contracts and their events stream into the local indexer (api at `http://localhost:3800`, indexer at `http://localhost:3700`). Deploy a subgraph against it with:

```bash
SL_API_URL=http://localhost:3800 SL_SERVICE_KEY=dummy sl subgraphs deploy ./subgraph.ts
```

To see rows appear you need a real contract-call transaction — `clarinet console` runs against simnet, not the devnet, so it won't broadcast on-chain. Fire one with `@stacks/transactions` (uses the well-known devnet deployer key):

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

The row shows up at `GET http://localhost:3800/api/subgraphs/<name>/<table>` within ~5s.

### sl devnet down

Stop the local Secondlayer stack started by `sl devnet connect`.

Usage: `sl devnet down`

| Flag | Default | Description |
| --- | --- | --- |
| `--project <dir>` | nearest `Clarinet.toml` | Clarinet project directory. |
| `--purge` | false | Also remove volumes (wipes the local index — use when restarting the devnet from scratch). |

---

## Stack

Manage the full local stack (node + dev services). Requires `network=local`.

### sl stack start

Start the full stack.

Usage: `sl stack start`

| Flag | Description |
| --- | --- |
| `--no-node` | Skip starting the Stacks node. |
| `--no-dev` | Skip starting dev services. |
| `--network <network>` | Override node network (`mainnet` \| `testnet`). |

Validates Docker + network consistency, starts node containers, polls RPC for up to 60s, then starts dev services.

### sl stack stop

Stop the full stack.

Usage: `sl stack stop`

| Flag | Description |
| --- | --- |
| `--no-node` | Skip stopping the node. |
| `--no-dev` | Skip stopping dev services. |
| `--wait` | Wait for in-flight work to drain. |

Also cleans up orphaned `secondlayer-dev*`/`stacks*` exited containers.

### sl stack restart

Restart the full stack.

Usage: `sl stack restart`

| Flag | Description |
| --- | --- |
| `--no-node` | Skip restarting the node. |
| `--no-dev` | Skip restarting dev services. |

---

## DB

Inspect the local indexer Postgres database. Requires `network=local`. Defaults `DATABASE_URL` to `postgres://postgres:postgres@localhost:5432/secondlayer_dev` if unset.

### sl db (overview)

Show overview (counts + latest block).

Usage: `sl db`

No flags.

### sl db blocks

Show recent blocks.

Usage: `sl db blocks`

| Flag | Default | Description |
| --- | --- | --- |
| `--limit <n>` | `10` | Number of rows. |
| `--json` | false | Output as JSON. |

### sl db txs

Show recent transactions.

Usage: `sl db txs`

Same flags as `blocks`.

### sl db events

Show recent events.

Usage: `sl db events`

Same flags as `blocks`.

### sl db gaps

Show gaps in indexed block data.

Usage: `sl db gaps`

| Flag | Default | Description |
| --- | --- | --- |
| `--limit <n>` | `50` | Number of gaps to show. |
| `--json` | false | Output as JSON. |

### sl db reset

**DESTRUCTIVE.** Truncate all indexed data (`blocks`, `transactions`, `events`, `index_progress`). Subgraph configs preserved.

Usage: `sl db reset`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |

### sl db resync

**DESTRUCTIVE.** Reset DB and restart indexer for fresh sync.

Usage: `sl db resync`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |
| `--backfill` | After reset, fetch all blocks from node and POST them to `${INDEXER_URL}/new_block` (concurrency 5). |

---

## Account

Manage your public account profile.

### sl account profile

View or update your public profile. With no flags, prints current profile.

Usage: `sl account profile`

| Flag | Description |
| --- | --- |
| `--name <name>` | Set display name. |
| `--bio <bio>` | Set bio. |
| `--slug <slug>` | Set public URL slug. |
| `--json` | Output as JSON. |

---

## Billing

### sl billing status

Show your current plan, Stripe subscription, trial, and discounts.

Usage: `sl billing status`

No flags. GETs `/api/billing/status`.

---

## Config

Manage CLI configuration (`~/.config/secondlayer/config.json` or platform equivalent — see `sl config show` output for actual path).

### sl config show

Show current configuration.

Usage: `sl config show`

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

### sl config clear

Clear all configuration (delete config file).

Usage: `sl config clear`

No flags.

---

## Status

### sl status

Show system status (top-level).

Usage: `sl status`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |

GETs `/status` from the platform. Prints DB status, per-network index progress with chain-tip progress bar, gap summary, and active subgraph count. On failure: in local mode suggests `sl local start`; in hosted mode reports connectivity issue.

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

## Generate (top-level)

### sl generate

Generate TypeScript interfaces from Clarity contracts. Alias: `gen`.

Usage: `sl generate [files...]`

| Flag | Description |
| --- | --- |
| `-c, --config <path>` | Path to config file (default `secondlayer.config.ts`). |
| `-o, --out <path>` | Output file path. **Required** when using direct file/contract inputs (not config-based). |
| `-k, --api-key <key>` | Stacks node API key for direct RPC. Falls back to `STACKS_NODE_API_KEY` / `HIRO_API_KEY`. |
| `-w, --watch` | Watch for changes. |

Accepts `.clar` file paths, glob patterns, or deployed contract IDs (`SP…/ST…/SM…/SN….<name>`). When invoked with no positional args, reads `secondlayer.config.ts`.

Examples:
- `sl generate ./contracts/*.clar -o ./src/generated.ts`
- `sl generate SP2C2YFP12AJZB1M6DY7SF9A3PRHWKGYGVWQKW3.my-token -o ./src/generated.ts`
- `sl generate` (uses config file)

### sl init

Initialize a new `secondlayer.config.ts` file.

Usage: `sl init`

No flags. If `Clarinet.toml` exists in cwd, generates a config with the `clarinet()` plugin pre-wired. Errors if config already exists.
