# Secondlayer CLI (`secondlayer`) Reference

The `secondlayer` binary (alias `secondlayer`) is the official CLI for Secondlayer — dedicated Stacks indexing + real-time subgraphs. Install globally with `bun add -g @secondlayer/cli`. The binary is named `secondlayer`; `secondlayer` is a Commander alias for the same entry point. All commands accept a global `--network <network>` flag (`mainnet`, `testnet`, `devnet`) which is equivalent to setting `STACKS_NETWORK` before the call. `init`, `observer`, and `setup` exit 1 on any other value with a one-line error; other commands warn on stderr and keep the config default (`mainnet`).

## Global flags

| Flag | Description |
| --- | --- |
| `--network <network>` | Override network for this invocation (sets `STACKS_NETWORK`). Values: `mainnet`, `testnet`, `devnet`. |
| `--api-key <key>` | Instance credential for this invocation (sets `INSTANCE_TOKEN`). |
| `--api-url <url>` | Instance API for this invocation (sets `SL_API_URL`). Also what `init` writes as `SL_API_URL`. |
| `--version` | Print CLI version. |
| `--help` | Show help. |

**Output contract (for scripting/agents):** data goes to **stdout**, status/chrome to **stderr** (color auto-disables when piped). On instance read commands `--json` selects the full JSON envelope; `secondlayer streams`/`secondlayer index` already emit JSON to stdout (the `--json` flag is accepted there for uniformity). `-o, --output <path>` always means a **file path** (codegen/spec), never a format selector.

## Environment variables

| Var | Used by | Purpose |
| --- | --- | --- |
| `SL_API_URL` | every command that calls the instance | Override the instance API base URL. Default `http://127.0.0.1:3800`. |
| `INSTANCE_TOKEN` | writes, MCP, SDK | The token `secondlayer init` writes. The instance's only credential. Required for every write, and for every read once the API is published past loopback; loopback reads need no value. |
| `SL_API_KEY` | legacy alias of `INSTANCE_TOKEN` | Same value; `INSTANCE_TOKEN` wins when both are set. |
| `SL_PLATFORM_API_URL` | legacy alias of `SL_API_URL` | Same default: `http://127.0.0.1:3800`. |
| `HIRO_API_KEY` / `STACKS_NODE_API_KEY` | codegen contracts | API key passed to Hiro Stacks RPC when fetching contract ABIs. |
| `SIGNING_SECRET` | subscriptions test | Standard-Webhooks signing secret used to sign test fixtures. |
| `STACKS_NETWORK` | global | Network override (set by `--network`). |
| `SL_STREAMS_DUMPS_URL` | streams dumps | Public bulk-dump bucket base URL (dumps are public — no API key). Alternative to `--dumps-url`. |
| `DATABASE_URL` | bootstrap, verify, repair, backup, local db | Postgres URL. `secondlayer setup` writes it into `.env` pointing at the compose Postgres and passes it to the bootstrap/verify it runs; unset, it defaults to `postgres://postgres:postgres@localhost:5432/secondlayer_dev`. |
| `INDEXER_URL` | local db resync --backfill | Local indexer URL; defaults to `http://localhost:<config.ports.indexer>`. |
| `DEBUG` | codegen contracts | When set, prints stack traces on failure. |

Global flags `--api-key <key>` and `--api-url <url>` are available on every command and override `INSTANCE_TOKEN` / `SL_API_URL` for that invocation.

## Table of contents

- [Local runtime](#local-runtime) — `setup`, `init`, `console`, `bootstrap`, `observer`, `verify`, `repair`, `backup`, `restore`, `uninstall`
- [Credits](#credits) — `credits buy|balance|refill`
- [Subgraphs](#subgraphs) — `create`, `dev`, `deploy`, `list`, `status`, `spec`, `source`, `reindex`, `backfill`, `stop`, `operations`, `gaps`, `query`, `delete`, `scaffold`
- [Subscriptions](#subscriptions) — `create`, `list`, `get`, `update`, `pause`, `resume`, `delete`, `rotate-secret`, `deliveries`, `dead`, `requeue`, `replay`, `doctor`, `test`
- [Index](#index) — `ft-transfers`, `nft-transfers`, `events`, `contract-calls`
- [Streams](#streams) — `tip`, `events`, `consume`, `reorgs`, `canonical`, `dumps`
- [Local](#local) — `local up|down|restart|status|logs`, `local node …`, `local db …`
- [Devnet](#devnet) — `local up --devnet` / `local down --devnet`, `devnet status|logs` (run services against a Clarinet devnet)
- [Config](#config) — `config get|set|reset|delete`
- [Status](#status) — top-level `status`
- [Doctor](#doctor) — top-level `doctor`
- [Codegen](#codegen) — `codegen contracts|subgraph|index|client|prints`

---

## Local runtime

Accountless. These are the top-level verbs for a machine you operate. There is no login, no project, and no `secondlayer instance`.

### secondlayer setup

Guided self-host onboarding — one command in place of `init` → hand-copy 3 secrets into `docker/oss/.env` → `docker compose up -d` → `observer` → hand-paste into the node's `Config.toml` → `bootstrap` → `verify`. Generates secrets via the same functions `init` uses (idempotent, same re-run behavior), writes `docker-compose.yml` and the resolved `.env` into a target directory (no manual copy-paste), brings the stack up, prints the observer stanza (marked ACTION REQUIRED for `--node-mode external`, since the wizard cannot edit a node it doesn't control), and restores + verifies history from the archive.

Usage: `secondlayer setup [--network mainnet|testnet|devnet] [--node-mode external|stacks|full] [--api-port <spec>] [--dir <path>] [--against <manifest>] [--skip-bootstrap] [--skip-verify] [--yes] [--force]`

| Flag | Default | Description |
| --- | --- | --- |
| `--network <network>` | none — required | `mainnet`, `testnet`, or `devnet`. No safe default: different disk floors, irreversible-ish choice. |
| `--node-mode <mode>` | none — required | `external` (you run the Stacks node) or `stacks` (same — no bundled bitcoind, no bundled-stacks-only compose profile), or `full` (bundled Stacks node + bitcoind). |
| `--api-port <spec>` | `127.0.0.1:3800` | API publish spec, matching `docker/oss/docker-compose.yml`'s default. |
| `--dir <path>` | cwd | Target directory for `docker-compose.yml` and `.env`. |
| `--against <manifest>` | suggested: `https://archive.secondlayer.tools/latest.json` | Archive manifest to bootstrap from. Required unless `--skip-bootstrap`. |
| `--skip-bootstrap` | off | Sync from genesis instead of restoring an archive. |
| `--skip-verify` | off | Skip the post-bootstrap verify pass. |
| `--yes` | off | Skip the interactive TUI; run from flags only, never prompt. Also implied by a non-TTY stdout (piped, CI, an agent). |
| `--force` | off | Regenerate secrets even if a `.env` already exists in `--dir`. |

With a TTY and no `--yes`, this launches an OpenTUI wizard: network → node mode (RAM/disk floor shown live per highlighted option) → bootstrap source → a confirm screen → a running view with a step list and scrolling log. Without a TTY, or with `--yes`, every decision with no safe default must come from a flag or the command fails fast naming exactly which one is missing — this is what lets an agent drive it exactly as well as a human at a terminal.

Example: `secondlayer setup --yes --network mainnet --node-mode external --against https://archive.secondlayer.tools/latest.json`

### secondlayer init

Write `.env.local` (instance token, secrets key, webhook signing key). Idempotent.

Usage: `secondlayer init [--network <network>] [--api-url <url>] [--force]`

| Flag | Default | Description |
| --- | --- | --- |
| `--network <network>` | `STACKS_NETWORK` or `mainnet` | Global flag. `mainnet`, `testnet`, or `devnet`. |
| `--api-url <url>` | `SL_API_URL` or `http://127.0.0.1:3800` | Global flag. Local API URL written as `SL_API_URL`. |
| `--force` | off | Overwrite generated values even if `.env.local` exists. |

Does **not** write `secondlayer.config.ts` — that file is for `secondlayer codegen contracts`.

Example: `secondlayer init --network mainnet`

### secondlayer console

Open the instance's web console (a container behind the `console` compose profile — `docker compose --profile console up -d`).

Usage: `secondlayer console [--url <url>] [--no-open]`

| Flag | Default | Description |
| --- | --- | --- |
| `--url <url>` | `http://localhost:3801/console` | Console URL. |
| `--no-open` | (opens a browser) | Print the URL instead. |

Loopback is open; anything past it takes `CONSOLE_TOKEN`, which falls back to `INSTANCE_TOKEN`. There are no per-user console logins — one instance, one token.

### secondlayer bootstrap

Restore chain history from a verified archive into an empty database. Refuses a target that already holds a completed bootstrap (`index_progress` present); use `secondlayer repair` for that. A run that died mid-way is resumed on re-run: each of blocks, transactions, and events keeps its own high-water mark, a torn partition is truncated and reloaded, sealed partitions are skipped, and a load that finished but never wrote progress is verified and finalized.

Usage: `secondlayer bootstrap --against <manifest> [--from-block <n>] [--to-block <n>] [--verify all|blocks] [--public-key <pem>] [-y] [--json]`

| Flag | Default | Description |
| --- | --- | --- |
| `--against <manifest>` | required | Archive manifest: https URL or local file path. |
| `--from-block <n>` | genesis | Forward-only restore from this height; earlier history is declared out of scope, and only ranges at or above it are verified. |
| `--to-block <n>` | archive tip | Stop at this height. |
| `--verify <datasets>` | `all` | Digests checked after the load. `all` covers blocks, transactions, and events and adds minutes on a full chain; `blocks` checks block identity only. |
| `--public-key <pem>` | resolved | Pin the signing key instead of fetching it. |
| `-y, --yes` | off | Skip the confirmation prompt. |
| `--json` | off | Machine output. Not consent: without `-y` it prints `{"code":"CONFIRMATION_REQUIRED","quote":…}` and exits 2. |

Exit codes: `0` restored and verified, `1` restore completed but verification diverged, `2` refused (non-empty target or untrusted reference).

OSS never fetches `api.secondlayer.tools` for the public key.

Against the official archive, the confirm prompt quotes partitions, dollars, and your credit balance before anything is charged; your own mirrors and local archives never touch the gate. Presigned URLs are issued in load order (blocks, then transactions, then events) in batches of 16, so a charge lands right before its bytes are used, and a URL with under a minute left is re-issued before download. See [Credits](#credits).

The JSON report carries `verified_datasets`, `ranges_verified`, `divergent_ranges`, and `divergent` (the ranges by dataset).

Example: `secondlayer bootstrap --against ./snapshot.json --to-block 4000000 --yes`

### secondlayer observer

Print the Stacks `[[events_observer]]` stanza.

Usage: `secondlayer observer [--mode indexer|signer-shared] [--endpoint host:port] [--recovery journal|archive] [--network <network>]`

| Flag | Default | Description |
| --- | --- | --- |
| `--mode <mode>` | `indexer` | `indexer` retries delivery (`timeout_ms = 2000`). `signer-shared` skips retries (`timeout_ms = 500`, `disable_retries = true`). |
| `--endpoint <host:port>` | `indexer:3700` (`127.0.0.1:3700` on devnet) | Node callback. `host:port` only — no URL, no unix socket. Loopback refused except on `devnet`. |
| `--recovery <source>` | required for signer-shared | `journal` or `archive`. |
| `--network <network>` | `STACKS_NETWORK` or `mainnet` | `mainnet`, `testnet`, or `devnet`. |

Example: `secondlayer observer --mode indexer --endpoint indexer:3700`

### secondlayer verify

Compare local chain data against a signed archive. Read-only. Nothing is uploaded.

Usage: `secondlayer verify [target] --against <manifest> [--quick] [--deep] [--anchor] [--from-block <n>] [--to-block <n>] [--counts] [--semantic] [--public-key <pem>] [--insecure] [--json]`

`target` is `all`, `raw` (default), `decode:<name>`, or `subgraph:<name>`.

| Flag | Default | Description |
| --- | --- | --- |
| `--against <manifest>` | required | Archive manifest: https URL or local file path. |
| `--quick` | on | Identity-column digests only. |
| `--deep` | off | Also recompute semantic digests. |
| `--anchor` | off | Require a verified archive signature. |
| `--from-block <n>` / `--to-block <n>` | full manifest | Limit the checked range. |
| `--counts` | off | Also compare transaction/event row counts. |
| `--semantic` | off | Alias of `--deep`. |
| `--public-key <pem>` | resolved | Pin the signing key. |
| `--insecure` | off | Skip signature check. Result is unverified. |
| `--json` | off | Machine output. |

Exit codes: `0` clean, `1` diverged, `2` unanchored (reference unreachable, signature failed, or no matching dataset).

Example: `secondlayer verify decode:ft_transfer --against ./snapshot.json --deep`

### secondlayer repair

Replace local chain data that diverges from a signed archive. Dry-run by default. With `--apply`, a fixed block is rewritten together with its transactions and events from the archive's partitions for that height, in one transaction per partition, and all three datasets are re-verified. When the reference carries no transactions or events partition for a height, the block is rewritten alone, the run names the height with the remedy `secondlayer bootstrap --from-block H --to-block H`, and it exits 1; the stale rows underneath stay in place rather than becoming an unnamed hole.

Usage: `secondlayer repair --against <archive> [--apply] [--from-block <n>] [--to-block <n>] [--public-key <pem>] [-y] [--json]`

| Flag | Default | Description |
| --- | --- | --- |
| `--against <archive>` | required | Archive manifest URL or path. |
| `--apply` | off | Write the repair. Without it, print the plan only. |
| `--from-block <n>` / `--to-block <n>` | full archive | Limit the repaired range. |
| `--public-key <pem>` | resolved | Pin the signing key. |
| `-y, --yes` | off | Skip the confirmation prompt for a metered fetch. |
| `--json` | off | Machine output; the report carries `metered`. Not consent: a metered fetch without `-y` prints `{"code":"CONFIRMATION_REQUIRED","quote":…}` and exits 2. |

Exit codes: `0` ok, `1` divergence remains (or transactions/events at some height could not be rewritten), `2` unanchored.

The JSON report carries `rows_written` (per dataset), `datasets_rewritten`, `heights_missing_child_partitions`, and `remaining_by_dataset`.

Example: `secondlayer repair --against ./snapshot.json` then `secondlayer repair --against ./snapshot.json --apply`

### secondlayer backup / restore

`backup` writes an encrypted bundle (index, keys, scope); `restore` reads it back. Both carry a secrets-key canary, so restoring with the wrong key fails immediately.

Usage: `secondlayer backup --out <dir> [--passphrase <p>] [--no-secrets] [--json]`
Usage: `secondlayer restore --from <dir> [--passphrase <p>] [--apply] [--force] [--json]`

`restore` is a dry run until `--apply`, and refuses a database that already holds chain data unless `--force`. `SECONDLAYER_BACKUP_PASSPHRASE` substitutes for `--passphrase`.

### secondlayer uninstall

Stop the stack and leave the data. Containers, networks, and the handler cache come down; the index, chainstate, secrets, and backups stay.

Usage: `secondlayer uninstall [--apply] [--compose <file>] [--purge --backup <dir>] [--yes] [--json]`

Dry run by default — prints the plan and changes nothing until `--apply`. Run it from the directory `secondlayer setup` wrote: `--compose` defaults to `./docker-compose.yml` with `--env-file ./.env`, falling back to the repo's `docker/oss/docker-compose.yml` for a hand-run checkout. The dry run names the compose file, env file, and the file the keys were found in (`.env` or `.env.local`). `--purge` also destroys the volumes and refuses to run unless `--backup <dir>` points at a bundle proving your keys exist elsewhere.

---

## Credits

Archive fetches are the only thing that costs money. Credits are a prepaid card balance, not a credential: no account, no login. Verification is always free.

### secondlayer credits buy

Open a one-time card checkout against `archive.secondlayer.tools`.

Usage: `secondlayer credits buy --email <email> [--pack <usd>] [--json]`

| Flag | Default | Description |
| --- | --- | --- |
| `--email <email>` | required | Receipt email. |
| `--pack <usd>` | `25` | One of `10`, `25`, `50`, `100`. |

### secondlayer credits balance

Show the prepaid balance. Usage: `secondlayer credits balance [--json]`

### secondlayer credits refill

Opt-in auto-refill; off until you set it.

Usage: `secondlayer credits refill --below <usd> [--pack <usd>] [--off] [--json]`

`bootstrap` and `repair` draw credits per partition bundle fetched from the official archive and quote the price against your balance before charging. The first six repair bundles each month are free, and the prepaid balance is a hard cap.

---

## Subgraphs

Manage materialized subgraphs. Subcommands hit your instance at `SL_API_URL`; writes send `INSTANCE_TOKEN` as the bearer whenever the instance has one, loopback included. Only an instance with no token set at all needs no key. Local deploys (`network=local`) write straight to the local Postgres dev DB.

### secondlayer subgraphs create

Scaffold a new subgraph definition file at `./subgraphs/<name>.ts`.

Usage: `secondlayer subgraphs create <name>`

| Flag | Default | Description |
| --- | --- | --- |
| `--from-contract <contractId>` | — | Generate sources/schema/handlers from the contract's observed print events (requires network). |
| `--table-per-topic` | off | With `--from-contract`: one table per print topic instead of a single wide table. |

With no flags it writes an empty starter. Writes to `subgraphs/<name>.ts` (creates `subgraphs/` if missing). Errors if the file already exists. The `Next:` line is `git add subgraphs/<name>.ts && secondlayer subgraphs deploy subgraphs/<name>.ts`; deploy refuses an unstaged file unless `--allow-uncommitted`.

Example: `secondlayer subgraphs create my-watcher --from-contract SP3....my-contract`

### secondlayer subgraphs dev

Watch a subgraph file and auto-redeploy on change (LOCAL ONLY — requires `network=local`).

Usage: `secondlayer subgraphs dev <file>`

No flags. Deploys once, then re-deploys on file changes (300ms debounce). Reads/writes directly to local Postgres via `@secondlayer/shared/db`. Ctrl-C to stop.

Example: `secondlayer subgraphs dev subgraphs/my-watcher.ts`

### secondlayer subgraphs deploy

Deploy a subgraph definition file. Alias: `secondlayer subgraphs update <file>` — deploy is create-or-update.

Usage: `secondlayer subgraphs deploy <file>`

| Flag | Default | Description |
| --- | --- | --- |
| `--start-block <n>` | (from definition) | Override definition's `startBlock` for this deploy (nonneg integer). |
| `--tip-first` | false | Go live at chain tip immediately; history backfills behind you. Requires order-tolerant handlers (commutative or insert-only writes). |
| `--dry-run` | false | Validate and preview without writing. |
| `-y, --yes` | false | Skip confirmation prompt for reindex operations (DROP + reindex). |
| `--strict` | false | Run `bunx tsc --noEmit` on handler before deploy. |
| `--allow-uncommitted` | false | Deploy a definition file that is untracked or has unstaged edits in git. |

Deploy bundles the handler via `@secondlayer/bundler` and POSTs it to the instance. Server returns one of `unchanged`, `handler_updated`, `created`, `updated`, `reindexed`. **Destructive (`reindexed`) deploys prompt for confirmation** unless `-y` is set. Local deploy: writes to local DB via `deploySchema()`.

Deploy refuses a definition file that isn't staged or committed in git — a prompt in a terminal, a hard failure in CI — because a deployed definition whose source isn't in version control exists only as a database row. `git add <file>` is enough; a staged copy is recoverable. `--allow-uncommitted` overrides it and prints a line saying so. Deploys from outside a git repo, and `--dry-run`, are unaffected. The reindex prompt gates on stdin: without a TTY and without `-y` it exits 1 before any request, so a pipe can never answer it.

Deploys are open on any instance: no trial, no quota, and no visibility flag. Reads on `/v1/subgraphs/*` follow the same rule as Index and Streams — keyless while the API is published on loopback, `INSTANCE_TOKEN` past it. Who can reach the instance is your publish spec and your reverse proxy, not a per-subgraph setting.

Example: `secondlayer subgraphs deploy subgraphs/my-watcher.ts --start-block 100000`

### secondlayer subgraphs list

List all deployed subgraphs (alias: `ls`).

Usage: `secondlayer subgraphs list`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |

### secondlayer subgraphs status

Show detailed subgraph status (sync, gaps, errors, table row counts, endpoints).

Usage: `secondlayer subgraphs status <name>`

| Flag | Description |
| --- | --- |
| `-w, --watch` | Refresh every 2s until synced or Ctrl-C. Clears screen between renders. |

Example: `secondlayer subgraphs status my-watcher -w`

### secondlayer subgraphs spec

Output API documentation for a subgraph. Accepts either a **deployed subgraph name** (fetched from the API) or a **local `.ts` file** (bundled in-process, no API call).

Usage: `secondlayer subgraphs spec <nameOrFile>`

| Flag | Default | Description |
| --- | --- | --- |
| `--format <format>` | `openapi` | One of: `openapi`, `agent`, `markdown`. |
| `-o, --output <path>` | (stdout) | Write to file instead of stdout. |
| `--server <url>` | (from API) | Override server URL in generated docs. |

Examples:
```bash
secondlayer subgraphs spec my-watcher --format agent -o ./docs/my-watcher.json   # deployed name
secondlayer subgraphs spec subgraphs/my-watcher.ts                               # local file, no server call
```

### secondlayer subgraphs reindex

**DESTRUCTIVE.** Drop every row and rebuild the subgraph from its `startBlock` to chain tip.

Usage: `secondlayer subgraphs reindex <name>`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip the confirmation prompt. |

Reindex is always whole-subgraph — there is no `--from-block`/`--to-block`, and the API answers `400 REINDEX_RANGE_NOT_SUPPORTED`. For a specific range use `secondlayer subgraphs backfill`, which never drops anything.

Prompts for confirmation by default (default answer: **no**). Non-TTY environments must pass `-y` or the command exits non-zero.

### secondlayer subgraphs backfill

Backfill a block range without dropping existing data.

Usage: `secondlayer subgraphs backfill <name> --from-block <block> --to-block <block>`

| Flag | Required | Description |
| --- | --- | --- |
| `--from-block <block>` | yes | Start block height. |
| `--to-block <block>` | yes | End block height. |

### secondlayer subgraphs stop

Stop a running reindex or backfill operation. Rows already written stay — stopping cancels the operation, it does not roll it back.

Usage: `secondlayer subgraphs stop <name>`

No flags.

### secondlayer subgraphs operations

Operation history — the verify step for `deploy`, `reindex`, and `backfill`. Every reindexing deploy, reindex, and backfill enqueues a tracked operation; this shows whether it is queued, running, completed, cancelled, or failed (with the error). Pass an operation id for the single-operation view.

Usage: `secondlayer subgraphs operations <name> [operationId]`

| Flag | Default | Description |
| --- | --- | --- |
| `--json` | false | Output as JSON (`{ operations: [...] }`, or the single operation). |

Example: `secondlayer subgraphs operations my-watcher --json`

### secondlayer subgraphs source

Print the source of the **deployed** definition, which is not always what is on disk. Subgraphs deployed before source capture return no source (redeploy to make them recoverable) and the command exits non-zero.

Usage: `secondlayer subgraphs source <name>`

| Flag | Default | Description |
| --- | --- | --- |
| `-o, --output <path>` | (stdout) | Write the source to a file. |
| `--json` | false | Full response (`name`, `version`, `sourceCode`, `readOnly`, `updatedAt`). |

Example: `secondlayer subgraphs source my-watcher -o subgraphs/my-watcher.ts`

### secondlayer subgraphs gaps

Show block gaps for a subgraph.

Usage: `secondlayer subgraphs gaps <name>`

| Flag | Default | Description |
| --- | --- | --- |
| `--resolved` | false | Include resolved gaps. |
| `--limit <n>` | `50` | Max gaps to return. |
| `--json` | false | Output as JSON. |

### secondlayer subgraphs query

Query a subgraph table.

Usage: `secondlayer subgraphs query <name> <table>`

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

Example: `secondlayer subgraphs query my-watcher transfers --sort _block_height --order desc --limit 50 --filter amount.gte=1000`

### secondlayer subgraphs delete

**DESTRUCTIVE.** Delete a subgraph and all its data.

Usage: `secondlayer subgraphs delete <name>`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |
| `--force` | Cancel active operations and force delete. |

Refuses to run without a TTY unless `-y` is passed. Idempotent: a 404 after a previous delete prints "already deleted" rather than erroring.

### secondlayer subgraphs scaffold

Scaffold a deploy-ready `defineSubgraph()` file (real handlers, not stubs).
**Standard-aware**: it classifies the contract's ABI and emits the *useful* source —
a SIP-010 token → an `ft_transfer` source over its asset, a SIP-009 → `nft_transfer`,
anything else → a single generic `calls` table.

Usage: `secondlayer subgraphs scaffold [contractAddress]`

| Flag | Required | Description |
| --- | --- | --- |
| `-o, --output <path>` | yes | Output file path. |
| `--functions <a,b>` | no | Index these public functions as typed `contract_call` tables (positional arg decode) instead of the generic `calls` table. |
| `--trait <std>` | no | Scaffold a **trait-scoped** source (`sip-009\|sip-010\|sip-013`) that indexes every conforming contract — no `<contractAddress>` needed. |
| `--no-install` | no | Skip `bun install` in output directory. |

Examples:
```bash
secondlayer subgraphs scaffold SM3VD….sbtc-token -o subgraphs/sbtc.ts        # → ft_transfer source
secondlayer subgraphs scaffold SP….amm --functions swap,add-liquidity -o subgraphs/amm.ts
secondlayer subgraphs scaffold --trait sip-010 -o subgraphs/all-tokens.ts    # all SIP-010 tokens
```

---

## Subscriptions

Manage subgraph table subscriptions (webhook deliveries). Alias: `subs`. All subcommands take the credential and endpoint from the global `--api-key` / `--api-url` flags, or from `INSTANCE_TOKEN` / `SL_API_URL` in the environment. These are writes, so they send the token even on loopback.

Subscription references (`<idOrName>`) accept the subscription UUID or its name. Ambiguous names error out — use the ID.

Subscriptions come in two kinds: **subgraph** (fires on subgraph table rows) and **chain** (fires on raw chain events, no subgraph). `create` here only makes subgraph subscriptions; all other subcommands (`list`, `get`, `update`, `pause`, `resume`, `delete`, `deliveries`, etc.) operate on both kinds.

### secondlayer subscriptions create

Scaffold a subscription receiver for a runtime and provision the subscription via the API. **Creates subgraph subscriptions only** (fires on rows written to a subgraph table — `--subgraph` + `--table`). To create a **chain subscription** (raw chain events, no subgraph — `triggers`), use the SDK (`sl.subscriptions.create({ triggers: [...] })`, see `references/sdk.md`), REST (`POST /api/subscriptions` with `triggers`), or MCP (`subscriptions_create` with `triggers`). The CLI has no `--triggers` flag.

Usage: `secondlayer subscriptions create <name>`

| Flag | Description |
| --- | --- |
| `-r, --runtime <runtime>` | `inngest` \| `trigger` \| `cloudflare` \| `node`. Defaults to `node` once any of `-s/-t/-u` or `--no-scaffold` is given; prompts only in a terminal with no flags. |
| `-s, --subgraph <name>` | Subgraph to subscribe to. Prompts if omitted (exit 1 without a TTY). |
| `-t, --table <name>` | Table to subscribe to. Prompts if omitted (exit 1 without a TTY). |
| `-u, --url <url>` | Webhook URL. Prompts if omitted (exit 1 without a TTY). Must be http/https. |
| `--auth-token <token>` | Bearer token for receiver-side auth. |
| `--filter <kv...>` | Repeatable. `key=value` with `.eq/.neq/.gt/.gte/.lt/.lte` suffixes. |
| `--api-key <key>` | `INSTANCE_TOKEN` override. |
| `--api-url <url>` | `SL_API_URL` override. |
| `--skip-api` | Copy template only; do NOT create the subscription via API. |
| `--no-scaffold` | Skip the local runtime template directory (webhook-only setups — provisions subscription only). |

Behavior:
1. Validates target subgraph + table + filter via API (skipped with `--skip-api`).
2. Copies template into `./<name>/` (skipped with `--no-scaffold`).
3. POSTs `/api/subscriptions` to create the subscription with the matching `format`/`runtime`.
4. Writes returned `SIGNING_SECRET` into `./<name>/.env` (or prints if `--no-scaffold`).

`format` is derived from `runtime`: `inngest`→`inngest`, `trigger`→`trigger`, `cloudflare`→`cloudflare`, `node`→`standard-webhooks`.

Example: `secondlayer subscriptions create my-sub -r node -s my-watcher -t transfers -u https://app.example/webhook`

Webhook-only (no scaffold): `secondlayer subscriptions create notify --no-scaffold -r node -s my-watcher -t transfers -u https://app.example/webhook`

### secondlayer subscriptions list

List subscriptions (alias: `ls`).

Usage: `secondlayer subscriptions list`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |
| `--api-key <key>` | `INSTANCE_TOKEN` override. |
| `--api-url <url>` | `SL_API_URL` override. |

### secondlayer subscriptions get

Show subscription details.

Usage: `secondlayer subscriptions get <idOrName>`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |
| `--api-key <key>` / `--api-url <url>` | API auth overrides. |

### secondlayer subscriptions update

Update subscription config (any subset of fields).

Usage: `secondlayer subscriptions update <idOrName>`

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
| `--api-key <key>` / `--api-url <url>` | API auth overrides. |

If `--filter` is set, the new filter is validated against the target subgraph table before applying.

### secondlayer subscriptions pause

Pause a subscription.

Usage: `secondlayer subscriptions pause <idOrName>`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |
| `--api-key <key>` / `--api-url <url>` | API auth overrides. |

### secondlayer subscriptions resume

Resume a subscription.

Usage: `secondlayer subscriptions resume <idOrName>`

Same flags as `pause`.

### secondlayer subscriptions delete

**DESTRUCTIVE.** Delete a subscription (pending outbox rows are removed).

Usage: `secondlayer subscriptions delete <idOrName>`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |
| `--json` | Output as JSON. |
| `--api-key <key>` / `--api-url <url>` | API auth overrides. |

Refuses prompt without a TTY. 404 is treated as "already deleted" (idempotent).

### secondlayer subscriptions rotate-secret

**DESTRUCTIVE.** Rotate the signing secret. Existing receivers using the old secret will fail verification.

Usage: `secondlayer subscriptions rotate-secret <idOrName>`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |
| `--json` | Output as JSON. |
| `--api-key <key>` / `--api-url <url>` | API auth overrides. |

Prints the new secret to stdout. Capture immediately.

### secondlayer subscriptions deliveries

Show recent delivery attempts.

Usage: `secondlayer subscriptions deliveries <idOrName>`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |
| `--api-key <key>` / `--api-url <url>` | API auth overrides. |

### secondlayer subscriptions dead

Show dead-letter outbox rows (deliveries past max retries).

Usage: `secondlayer subscriptions dead <idOrName>`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |
| `--api-key <key>` / `--api-url <url>` | API auth overrides. |

### secondlayer subscriptions requeue

**DESTRUCTIVE.** Requeue one dead-letter row.

Usage: `secondlayer subscriptions requeue <idOrName> <outboxId>`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |
| `--json` | Output as JSON. |
| `--api-key <key>` / `--api-url <url>` | API auth overrides. |

### secondlayer subscriptions replay

**DESTRUCTIVE.** Replay a block range (re-emits matching rows to the receiver).

Usage: `secondlayer subscriptions replay <idOrName> --from-block <n> --to-block <n>`

| Flag | Required | Description |
| --- | --- | --- |
| `--from-block <n>` | yes | Start block (integer ≥ 0). |
| `--to-block <n>` | yes | End block (must be ≥ from). |
| `-y, --yes` | no | Skip confirmation. |
| `--json` | no | Output as JSON. |
| `--api-key <key>` / `--api-url <url>` | no | API auth overrides. |

Returns `replayId`, `enqueuedCount`, `scannedCount`.

### secondlayer subscriptions doctor

Diagnose subscription health (delivery stats, dead rows, linked subgraph sync, hints).

Usage: `secondlayer subscriptions doctor <idOrName>`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |
| `--api-key <key>` / `--api-url <url>` | API auth overrides. |

### secondlayer subscriptions test

Build (and optionally POST) a signed Standard-Webhooks fixture.

Usage: `secondlayer subscriptions test <idOrName>`

| Flag | Description |
| --- | --- |
| `--signing-secret <secret>` | Signing secret override (otherwise reads `SIGNING_SECRET`). Required if env unset. |
| `--post` | Actually POST the fixture to the subscription URL. |
| `--json` | Output as JSON (fixture + post result). |
| `--api-key <key>` / `--api-url <url>` | API auth overrides. |

Fetches a recent row from the target table (falls back to synthetic row by column type), signs body with the secret, prints body / headers / curl invocation. With `--post`, POSTs and prints the receiver's status + first 2000 chars of body.

Example: `SIGNING_SECRET=whsec_… secondlayer subscriptions test my-sub --post`

---

## Index

Query decoded Index (`/v1/index`). Loopback reads need no key. History is
whatever this instance has bootstrapped.

- `secondlayer index ft-transfers [--contract-id] [--sender] [--recipient] [--from-height] [--to-height] [--cursor] [--limit] [--json]`
- `secondlayer index nft-transfers [… --asset-identifier]`
- `secondlayer index events --event-type <type> [filters…]` — generic decoded events (stx_*, ft/nft mint/burn, print, …)
- `secondlayer index contract-calls [--function-name] [--sender] [filters…]`

```bash
secondlayer index ft-transfers --recipient SP… --limit 20
secondlayer index events --event-type print --contract-id SP….dao --limit 10
```

Mirrors `sl.index.{ftTransfers,nftTransfers,events,contractCalls}` in the SDK.

## Streams

Read raw chain events from Streams on this instance. Default API is `http://127.0.0.1:3800`. Loopback reads need no key. Override via `SL_API_URL`.

Valid event types: `stx_transfer`, `stx_mint`, `stx_burn`, `stx_lock`, `ft_transfer`, `ft_mint`, `ft_burn`, `nft_transfer`, `nft_mint`, `nft_burn`, `print`.

Cursor format: `block_height:event_index`.

### secondlayer streams tip

Print current canonical tip.

Usage: `secondlayer streams tip`

No flags. GET `/v1/streams/tip`.

### secondlayer streams events

List events (cursor-paginated; one page per call).

Usage: `secondlayer streams events`

| Flag | Default | Description |
| --- | --- | --- |
| `--types <types>` | — | Comma-separated event types. |
| `--contract-id <id>` | — | Filter to a single contract identifier. |
| `--cursor <cursor>` | — | Start cursor (`block_height:event_index`). |
| `--from-block <n>` | — | Filter to blocks ≥ n. |
| `--to-block <n>` | — | Filter to blocks ≤ n. |
| `--limit <n>` | `100` | Page size (1-1000). |

Prints full envelope (events + `next_cursor`) as JSON.

Example: `secondlayer streams events --types ft_transfer --contract-id SP3...sbtc-token --limit 500`

### secondlayer streams consume

Long-running pull from a cursor; emits one event per line (jsonl) until SIGINT or `--max-pages`.

Usage: `secondlayer streams consume`

| Flag | Default | Description |
| --- | --- | --- |
| `--types <types>` | — | Comma-separated event types. |
| `--contract-id <id>` | — | Filter to a single contract identifier. |
| `--cursor <cursor>` | — | Start cursor. |
| `--batch-size <n>` | `100` | Events per batch (1-1000). |
| `--max-pages <n>` | (∞) | Stop after N pages. |

Events go to stdout (jsonl); `next_cursor` checkpoints go to stderr as `# next_cursor=...`.

Example: `secondlayer streams consume --types print --contract-id SP3...my-contract --cursor 12345:0 > events.jsonl`

### secondlayer streams reorgs

List recent reorgs (cursor-paginated).

Usage: `secondlayer streams reorgs --since <cursor>`

| Flag | Default | Required | Description |
| --- | --- | --- | --- |
| `--since <cursor>` | — | yes | Start cursor. |
| `--limit <n>` | `100` | no | Page size. |

### secondlayer streams canonical

Canonical block metadata at a given height.

Usage: `secondlayer streams canonical <height>`

No flags.

Example: `secondlayer streams canonical 150000`

### secondlayer streams dumps

Download finalized bulk parquet dumps locally and verify each file's sha256 against the manifest. Dumps are **public** — no API key needed; pass `--dumps-url` or set `SL_STREAMS_DUMPS_URL`.

Usage: `secondlayer streams dumps --to <dir>`

| Flag | Default | Description |
| --- | --- | --- |
| `--to <dir>` | — | Output directory for downloaded parquet files. |
| `--dumps-url <url>` | `SL_STREAMS_DUMPS_URL` | Public bulk-dump bucket base URL. |
| `--from-block <n>` | — | Only pull dumps covering blocks ≥ n. |
| `--to-block <n>` | — | Only pull dumps covering blocks ≤ n. |

Example: `secondlayer streams dumps --to ./dumps --dumps-url https://dumps.secondlayer.tools --from-block 100000 --to-block 200000`

---

## Local

Manage local development environment. All `local` subcommands require `network=local` (set via `--network local` or `secondlayer config set network local`).

### secondlayer local up

Start all local dev services (API, indexer, worker, subgraphs).

Usage: `secondlayer local up`

| Flag | Default | Description |
| --- | --- | --- |
| `--indexer-port <port>` | `3700` | Indexer port. |
| `--api-port <port>` | `3800` | API port. |
| `--no-worker` | (worker on) | Skip worker service. |
| `--stacks-node` | false | Use port 3701 for indexer (avoids conflict with `stacks-blockchain-api`). |
| `-f, --foreground` | false | Run in foreground (blocking). Default is background. |

### secondlayer local down

Stop all local dev services.

Usage: `secondlayer local down`

No flags.

### secondlayer local restart

Restart dev services (preserves Docker containers).

Usage: `secondlayer local restart`

No flags.

### secondlayer local status

Show local environment status (dev services + node summary if running).

Usage: `secondlayer local status`

No flags.

### secondlayer local logs

View local service logs (dev + node).

Usage: `secondlayer local logs`

| Flag | Default | Description |
| --- | --- | --- |
| `-s, --service <name>` | (all) | Filter by service: `api`, `indexer`, `worker`, `subgraphs`, `node`. |
| `-f, --follow` | false | Follow log output. |
| `-n, --lines <n>` | `50` | Number of lines to show. |
| `-q, --quiet` | false | Filter out common noise. |

### secondlayer local node setup

Interactive setup wizard for Stacks node.

Usage: `secondlayer local node setup`

No flags.

### secondlayer local node start

Start the Stacks node.

Usage: `secondlayer local node start`

| Flag | Description |
| --- | --- |
| `-p, --path <path>` | Path to `stacks-blockchain-docker` (overrides config). |
| `--with-indexer` | Also start indexer. |

### secondlayer local node stop

Stop the Stacks node.

Usage: `secondlayer local node stop`

| Flag | Description |
| --- | --- |
| `-p, --path <path>` | Path to `stacks-blockchain-docker`. |
| `-f, --force` | Skip confirmation. |
| `--wait` | Wait for in-flight work to drain first. |

### secondlayer local node restart

Restart the Stacks node (stop then start). Same flags as `stop`.

Usage: `secondlayer local node restart`

### secondlayer local node status

Show Stacks node status.

Usage: `secondlayer local node status`

| Flag | Description |
| --- | --- |
| `-p, --path <path>` | Path override. |
| `--json` | Output as JSON. |

### secondlayer local node config

Show node configuration.

Usage: `secondlayer local node config`

| Flag | Description |
| --- | --- |
| `--edit` | Run setup wizard interactively. |

### secondlayer local node config-check

Show events-observer configuration block to paste into `Config.toml`.

Usage: `secondlayer local node config-check`

| Flag | Default | Description |
| --- | --- | --- |
| `--indexer-port <port>` | `3700` | Indexer port to display. |

### secondlayer local node logs

Shortcut for `secondlayer local logs --service node`.

Usage: `secondlayer local node logs`

| Flag | Default | Description |
| --- | --- | --- |
| `-f, --follow` | false | Follow log output. |
| `-n, --lines <n>` | `50` | Number of lines. |
| `-q, --quiet` | false | Filter noise. |

---

## Devnet

Run Secondlayer services against a local [Clarinet](https://docs.hiro.so/stacks/clarinet) devnet. Unlike `secondlayer local up` (which runs the services from source for contributors), `secondlayer local up --devnet` pulls the published OSS Docker images, so it works for any developer with a clarinet project — no repo checkout required. Requires Docker (Docker Desktop or OrbStack) and `clarinet` installed.

### secondlayer local up --devnet

Point your clarinet project's devnet at a local Secondlayer stack and start it. Detects the nearest `Clarinet.toml`, adds the indexer to `settings/Devnet.toml`'s `stacks_node_events_observers` (idempotent; preserves your comments), writes `.secondlayer/docker-compose.yml`, and runs `docker compose up -d`.

Usage: `secondlayer local up --devnet`

| Flag | Default | Description |
| --- | --- | --- |
| `--project <dir>` | nearest `Clarinet.toml` | Clarinet project directory. |
| `--image-tag <tag>` | `latest` | Published OSS image tag to run. |
| `--owner <owner>` | `ryanwaits` | ghcr image owner (namespace) to pull from. |
| `--no-up` | (starts docker) | Patch config + write compose without starting Docker. |

Then run your normal `clarinet devnet start` — deployed contracts and their events stream into the local indexer (api at `http://localhost:3800`, indexer at `http://localhost:3700`). Deploy a subgraph against it with:

```bash
SL_API_URL=http://localhost:3800 INSTANCE_TOKEN=dev-instance-token secondlayer subgraphs deploy ./subgraph.ts
```

The generated compose publishes the api on `127.0.0.1` only and hands it that same spec as `API_PUBLISH_ADDR`, so `/v1` reads on a devnet are keyless. `dev-instance-token` is the stack's fixed local token: writes (deploys, subscriptions) send it, and the container needs it to boot at all, since it listens on `0.0.0.0` behind the loopback publish. The indexer is the one port published on every interface — the devnet's stacks-node container POSTs to `host.docker.internal:3700`, which is not loopback.

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

The row shows up at `GET http://localhost:3800/v1/subgraphs/<name>/<table>` within ~5s — no `Authorization` header needed.

### secondlayer local down --devnet

Stop the local Secondlayer stack started by `secondlayer local up --devnet`.

Usage: `secondlayer local down --devnet`

| Flag | Default | Description |
| --- | --- | --- |
| `--project <dir>` | nearest `Clarinet.toml` | Clarinet project directory. |
| `--purge` | false | Also remove volumes (wipes the local index — use when restarting your devnet from scratch). |

### secondlayer devnet status

Snapshot of the local stack: service health, ingest tip/lag, deployed subgraphs (status, block, tables, row counts), and a recent-activity table built from the subgraph rows. Node-native; reads `SL_API_URL` (default `http://localhost:3800`) and `INDEXER_URL` (default `http://localhost:3700`).

Usage: `secondlayer devnet status`

| Flag | Default | Description |
| --- | --- | --- |
| `-w, --watch` | false | Refresh every 2s until Ctrl-C. |
| `-n, --limit <n>` | `12` | Recent activity rows to show. |

### secondlayer devnet logs

Tail the stack's container logs.

Usage: `secondlayer devnet logs [service]` — `service` is optional, one of `indexer`, `api`, `subgraph-processor`, `postgres`.

| Flag | Default | Description |
| --- | --- | --- |
| `--project <dir>` | nearest `Clarinet.toml` | Clarinet project directory. |
| `-f, --follow` | false | Follow log output. |
| `-n, --lines <n>` | `200` | Lines to show from the end of each log. |

### Testing subscriptions locally

`secondlayer local up --devnet` starts the subscription emitter and configures the stack to deliver webhooks locally: it shares one secrets key across the api and subgraph-processor (so the emitter can decrypt a subscription's signing secret) and sets `SECONDLAYER_ALLOW_PRIVATE_EGRESS` (so webhooks can reach a localhost receiver). To test:

1. Deploy a subgraph (`secondlayer subgraphs deploy ./subgraph.ts`), then start a local chain with `clarinet devnet start`.
2. Create a subscription on the local API, pointing at a webhook receiver on your host. The emitter runs in a container, so use `host.docker.internal` instead of `localhost`:

```bash
curl -X POST http://localhost:3800/api/subscriptions \
  -H 'Authorization: Bearer dev-instance-token' \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-hook","subgraphName":"my-app","tableName":"counter_calls","url":"http://host.docker.internal:9999/hook"}'
```

3. Fire a contract call. The matched row is delivered to your receiver as a signed Standard-Webhooks payload; inspect attempts with `secondlayer subscriptions deliveries my-hook`.

---

## Local DB

Inspect the local indexer Postgres database. Nested under `local` (requires `network=local`). Defaults `DATABASE_URL` to `postgres://postgres:postgres@localhost:5432/secondlayer_dev` if unset.

### secondlayer local db (overview)

Show overview (counts + latest block).

Usage: `secondlayer local db`

No flags.

### secondlayer local db blocks

Show recent blocks.

Usage: `secondlayer local db blocks`

| Flag | Default | Description |
| --- | --- | --- |
| `--limit <n>` | `10` | Number of rows. |
| `--json` | false | Output as JSON. |

### secondlayer local db txs

Show recent transactions.

Usage: `secondlayer local db txs`

Same flags as `blocks`.

### secondlayer local db events

Show recent events.

Usage: `secondlayer local db events`

Same flags as `blocks`.

### secondlayer local db gaps

Show gaps in indexed block data.

Usage: `secondlayer local db gaps`

| Flag | Default | Description |
| --- | --- | --- |
| `--limit <n>` | `50` | Number of gaps to show. |
| `--json` | false | Output as JSON. |

### secondlayer local db truncate

**DESTRUCTIVE.** Truncate all indexed data (`blocks`, `transactions`, `events`, `index_progress`). Subgraph configs preserved.

Usage: `secondlayer local db truncate`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |

### secondlayer local db resync

**DESTRUCTIVE.** Reset DB and restart indexer for fresh sync.

Usage: `secondlayer local db resync`

| Flag | Description |
| --- | --- |
| `-y, --yes` | Skip confirmation. |
| `--backfill` | After reset, fetch all blocks from node and POST them to `${INDEXER_URL}/new_block` (concurrency 5). |

---

## Config

Manage CLI configuration (`~/.config/secondlayer/config.json` or the OS equivalent — see `secondlayer config get` output for the actual path).

### secondlayer config get

Show current configuration.

Usage: `secondlayer config get`

No flags. Prints config tree; in local mode also prints node + ports + database sections.

### secondlayer config set

Set a configuration value. Supports dot notation: `ports.api`, `node.network`, `database.url`, etc.

Usage: `secondlayer config set <key> <value>`

| Flag | Description |
| --- | --- |
| `--no-validate` | Skip connection validation for `database.url`. |

Validates `database.url` by attempting a `SELECT 1` Postgres query unless `--no-validate`.

Example: `secondlayer config set network local`

### secondlayer config reset

Reset configuration to defaults.

Usage: `secondlayer config reset`

No flags.

### secondlayer config delete

Clear all configuration (delete config file).

Usage: `secondlayer config delete`

No flags.

---

## Status

### secondlayer status

Show system status (top-level).

Usage: `secondlayer status`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |

GETs `/public/status` on this instance. Prints liveness and tip. On failure: check `docker compose ps` in the `secondlayer setup` directory and that the container is up.

---

## Doctor

### secondlayer doctor

Run diagnostics on the full stack.

Usage: `secondlayer doctor`

| Flag | Description |
| --- | --- |
| `--json` | Output as JSON. |

Checks `/public/status` on this instance, then local Docker / Postgres / config when present.

---

## Codegen

Every generated artifact lives under one verb. `-o, --output <path>` is always a
file path; where an ORM applies, `--target` defaults to `kysely`.

### secondlayer codegen contracts

Generate TypeScript interfaces from Clarity contracts.

Usage: `secondlayer codegen contracts [files...]`

| Flag | Description |
| --- | --- |
| `-c, --config <path>` | Path to config file (default `secondlayer.config.ts`). |
| `-o, --output <path>` | Output file path. **Required** when using direct file/contract inputs (not config-based). |
| `-k, --api-key <key>` | Stacks node API key for direct RPC. Falls back to `STACKS_NODE_API_KEY` / `HIRO_API_KEY`. |
| `-w, --watch` | Watch for changes. |

Accepts `.clar` file paths, glob patterns, or deployed contract IDs (`SP…/ST…/SM…/SN….<name>`). When invoked with no positional args, reads `secondlayer.config.ts`.

Examples:
- `secondlayer codegen contracts ./contracts/*.clar -o ./src/generated.ts`
- `secondlayer codegen contracts SP2C2YFP12AJZB1M6DY7SF9A3PRHWKGYGVWQKW3.my-token -o ./src/generated.ts`
- `secondlayer codegen contracts` (uses config file)

`secondlayer init` is the local-runtime command (writes `.env.local`). It does not create `secondlayer.config.ts` — write that file by hand for `secondlayer codegen contracts`.

### secondlayer codegen subgraph

Generate an ORM schema for a subgraph's tables. Point the ORM at the instance's
Postgres for a fully-typed client with relations and joins.

Usage: `secondlayer codegen subgraph <file>`

| Flag | Default | Description |
| --- | --- | --- |
| `--target <orm>` | `kysely` | `kysely`, `prisma`, or `drizzle`. |
| `--schema <name>` | `subgraph_<name>` | Postgres schema the tables live in. |
| `--env <var>` | `DATABASE_URL` | datasource url env var (Prisma only). |
| `--models-only` | — | Emit only Prisma models (compose via `prismaSchemaFolder`). |
| `-o, --output <path>` | stdout | Write to a file. |

The output mirrors the deployed DDL, so the subgraph owns the schema: run
`prisma db pull` / `drizzle-kit pull` to verify (it should be a no-op), never
`prisma migrate` / `drizzle-kit push`. Tables are processor-written — query them
read-only. `uint`→`Decimal`/`numeric` and the `BigInt` id need `.toString()` for
JSON. Relations require `relations` metadata on the subgraph schema.

Example: `secondlayer codegen subgraph subgraphs/dex.ts --target prisma -o prisma/schema.prisma`

### secondlayer codegen index

Generate a typed schema for the Index domain tables — point it at your BYO
database mirror.

Usage: `secondlayer codegen index`

| Flag | Default | Description |
| --- | --- | --- |
| `--target <orm>` | `kysely` | `kysely`, `prisma`, `drizzle`, or `json-schema`. |
| `--schema <name>` | — | Postgres schema to qualify table names with. |
| `--tables <list>` | all | Comma-separated subset of Index tables. |
| `--env <var>` | `DATABASE_URL` | Prisma datasource url env var. |
| `-o, --output <path>` | stdout | Write to a file. |

Example: `secondlayer codegen index --target kysely -o src/db/index-schema.ts`

### secondlayer codegen client

Generate a typed TypeScript query client for a deployed subgraph.

Usage: `secondlayer codegen client <subgraphName>`

| Flag | Required | Description |
| --- | --- | --- |
| `-o, --output <path>` | yes | Output file path. |

Fetches subgraph metadata, emits a typed query client. For an ORM schema on your
own database instead, see `secondlayer codegen subgraph`.

Example: `secondlayer codegen client my-watcher -o ./src/generated/my-watcher.ts`

### secondlayer codegen prints

Emit a `.d.ts` of print payload types for a subgraph's pinned `print_event`
sources, inferred from observed on-chain events (requires network).

Usage: `secondlayer codegen prints <file>`

| Flag | Default | Description |
| --- | --- | --- |
| `-o, --output <path>` | stdout | Write to a file. |

Example: `secondlayer codegen prints subgraphs/dex.ts -o subgraphs/dex.prints.d.ts`
