# @secondlayer/cli

The Secondlayer CLI — one binary for Stacks indexing, real-time subgraphs,
subscriptions, and Clarity code generation.

```bash
bun add -g @secondlayer/cli
secondlayer --version
```

`sl` is a short alias of `secondlayer`.

## Auth

Default API is `http://127.0.0.1:3800`. Override with `SL_API_URL`.

Writes against a published bind use `INSTANCE_TOKEN` from `secondlayer init`.
Loopback reads need no token. `SL_API_KEY` is a legacy alias of `INSTANCE_TOKEN`.

```bash
export SL_API_URL=http://127.0.0.1:3800
export INSTANCE_TOKEN=<from secondlayer init>
```

## Quickstart

```bash
bun add -g @secondlayer/cli
secondlayer setup

secondlayer subgraphs scaffold SP1234ABCD.my-contract -o subgraphs/my-contract.ts
secondlayer subgraphs deploy subgraphs/my-contract.ts --start-block <recent-block>
secondlayer subgraphs query my-contract <table> --sort _block_height --order desc
```

`secondlayer setup` is a guided wizard: it picks network + node mode (with the
RAM/disk floor shown live), generates secrets, writes `docker-compose.yml` and
`.env` into a target directory, brings the stack up, prints the observer
stanza for an external node, and restores + verifies history from the
archive — the one-command replacement for `init` → hand-copy secrets →
`docker compose up` → `observer` → `bootstrap` → `verify`. Without a TTY (or
with `--yes`), it skips the interactive prompts and runs from flags instead;
`--network` and `--node-mode` are then required, and `--against` is required
unless you pass `--skip-bootstrap`:

```bash
secondlayer setup --yes \
  --network mainnet --node-mode external \
  --against https://archive.secondlayer.tools/latest.json
```

`secondlayer subgraphs scaffold` writes the definition file, creates/updates
`package.json`, and runs `bun install` (pass `--no-install` to skip).

## Commands

### Local runtime

No account. Writes `.env.local`, restores history, prints the Stacks observer stanza.

| Command | What it does |
|---|---|
| `secondlayer setup [--network …] [--node-mode external\|stacks\|full] [--api-port <spec>] [--dir <path>] [--against <manifest>] [--skip-bootstrap] [--skip-verify] [--yes] [--force]` | Guided self-host onboarding — secrets, compose + `.env`, docker up, observer stanza, bootstrap, verify. TUI when interactive; flags-only (no prompts) with `--yes` or no TTY |
| `secondlayer init [--network mainnet\|testnet\|devnet] [--api-url <url>] [--force]` | Write `.env.local` (token, secrets key, webhook signing key). Idempotent |
| `secondlayer start [--print]` | Validate one-box config and print `docker compose up` |
| `secondlayer bootstrap --against <manifest> [--to-block <n>] [--public-key <pem>] [-y] [--json]` | Restore chain history from a verified archive into an empty database. Exit `0` restored, `1` diverged, `2` refused |
| `secondlayer observer [--mode indexer\|signer-shared] [--endpoint host:port] [--recovery journal\|archive] [--network …]` | Print the `[[events_observer]]` stanza. Signer-shared requires `--recovery` |
| `secondlayer verify [all\|raw\|decode:<name>\|subgraph:<name>] --against <manifest> [--quick\|--deep\|--anchor]` | Compare local data to a signed archive. Default target `raw`. Exit `0` clean, `1` diverged, `2` unanchored |
| `secondlayer repair --against <archive> [--apply] [-y]` | Plan (default) or apply an archive repair |

Bootstrap and repair against the official hosted archive (`archive.secondlayer.tools`)
are metered per partition; against any other manifest (a mirror, a teammate's
box, a local file) they are free. See [Metered fetches](#metered-fetches).

### Metered fetches

`secondlayer bootstrap` and `secondlayer repair` pull partitions from the
signed archive instead of replaying the chain, and that pull costs money only
when it targets the official hosted archive. Point `--against` at a mirror or
a local manifest and nothing is charged, nothing is even contacted beyond
that manifest, because self-hosting the archive is a supported way to use
these commands, not a workaround.

Against the official host, both commands quote before they charge:

1. The manifest's partition list is priced with a free, no-write call
   (`POST /api/archive/quote`).
2. The quote prints into the existing plan output, for example
   `metered: 528 partitions ≈ $44.00 · balance $50.00`, or for `repair`
   inside its monthly allowance, `metered: free (4 of 6 monthly repair
   fetches remaining)`.
3. You confirm, or pass `-y` to skip the prompt. `-y` never skips the quote
   or the balance check: if the balance is short, the command exits before
   any partition is fetched and prints the shortfall and
   `secondlayer credits buy`.
4. Only then does the command fetch, and only the partitions it actually
   reads are charged.

A partition already charged in the last 24 hours re-presigns for free, so a
resumed or retried bootstrap never pays twice for the same bytes. `repair`
gets 6 free range-bundles a month; `bootstrap` does not, since it is the
whole-chain operation the free tier exists to not subsidize.

`secondlayer verify` is unaffected: it reads manifests and digests, never
partition bytes, and stays free and anonymous no matter which archive it
points at.

### Subgraphs

| Command | What it does |
|---|---|
| `secondlayer subgraphs create <name>` | Scaffold a definition file |
| `secondlayer subgraphs scaffold <SP...::contract> [-o <path>] [--no-install]` | Generate a subgraph from a deployed contract |
| `secondlayer subgraphs deploy <file> [--start-block <n>]` | Deploy; `--start-block` overrides the definition |
| `secondlayer subgraphs list` | List deployments (`ls` alias) |
| `secondlayer subgraphs dev <file>` | Watch + hot-redeploy |
| `secondlayer subgraphs query <name> <table>` | Query a table with filters, sort, pagination |
| `secondlayer subgraphs status <name>` / `gaps <name>` | Inspect a deployment |
| `secondlayer subgraphs spec <nameOrFile> [--format openapi\|agent\|markdown]` | Export API docs for a deployed subgraph or a local definition file |
| `secondlayer codegen subgraph <file> --target kysely\|prisma\|drizzle [-o <path>]` | Generate a typed ORM schema for the subgraph's tables |
| `secondlayer codegen client <name> -o <path>` | Generate a typed query client for a deployed subgraph |
| `secondlayer subgraphs reindex/backfill/stop/delete <name>` | Manage processing |

### Data products (reads)

| Command | What it does |
|---|---|
| `secondlayer index ft-transfers` / `nft-transfers` / `events --event-type <t>` / `contract-calls` | Decoded Index layer. Anonymous reads OK |
| `secondlayer streams tip` / `events` / `consume` / `reorgs` / `canonical <h>` / `dumps` | Raw chain event firehose. **Requires `INSTANCE_TOKEN` past loopback** |

Reads emit JSON to stdout (`--json` accepted across all read commands); `-o/--output` is a file path, not a format.

### Subscriptions

| Command | What it does |
|---|---|
| `secondlayer subscriptions create <name> --subgraph <name> --table <name> [--runtime <inngest\|trigger\|cloudflare\|node>] [--url <url>]` | Subgraph subscription (optional local receiver scaffold) |
| `secondlayer subscriptions create <name> --url <url> --trigger '<json>'` | Chain subscription (repeat `--trigger` or pass `--triggers-file`) |
| `secondlayer subscriptions list` / `get <id\|name>` | List or show config + delivery state |
| `secondlayer subscriptions update <id\|name> --url <url> [--filter key.gte=value]` | Patch URL, filter, format, retry, etc. |
| `secondlayer subscriptions pause/resume <id\|name>` | Stop or restart delivery |
| `secondlayer subscriptions rotate-secret <id\|name>` | Rotate signing secret (printed once) |
| `secondlayer subscriptions deliveries/dead <id\|name>` | Recent attempts / dead-letter rows |
| `secondlayer subscriptions requeue <id\|name> <outboxId>` | Requeue one dead-letter row |
| `secondlayer subscriptions replay <id\|name> --from-block <n> --to-block <n>` | Enqueue a historical block range |
| `secondlayer subscriptions doctor/test <id\|name>` | Health check / signed fixture |

Read/action commands support `--json`. Destructive commands prompt unless
`-y` / `--yes`. Filters are schema-aware: unknown tables/columns, bad operators,
and non-scalar columns are rejected before the API call.

Subscriptions are **subgraph** (a table's rows) or **chain** (raw events, no
subgraph). `secondlayer subscriptions create` with `--subgraph`/`--table` makes the
first. Pass `--trigger` or `--triggers-file` for the second. SDK, REST, and
MCP take the same `triggers` array. Every other `secondlayer subscriptions` command
operates on both kinds.

### Other

| Command | What it does |
|---|---|
| `secondlayer codegen contracts [files...]` | Generate TS interfaces from Clarity contracts |
| `secondlayer context` | Instance snapshot — Streams + Index tips, subgraphs, subscriptions |
| `secondlayer doctor` / `secondlayer status` | Reachability + health checks |
| `secondlayer config get/set/reset/delete` | Inspect or reset local config |

## Environment variables

| Var | Purpose |
|---|---|
| `INSTANCE_TOKEN` | From `secondlayer init` for writes. Loopback reads need no token |
| `SL_API_KEY` | Legacy alias of `INSTANCE_TOKEN` |
| `SL_API_URL` | Instance API. Default `http://127.0.0.1:3800` |
| `SL_PLATFORM_API_URL` | Alias of `SL_API_URL` |
| `STACKS_NETWORK` | Default network (also via `--network <local\|testnet\|mainnet>`) |
| `HIRO_API_KEY` | Used by `secondlayer codegen contracts` for remote contract fetches |

## Code generation (`secondlayer codegen contracts`)

Generate type-safe interfaces, functions, and optional React hooks from Clarity
contracts — local `.clar` files, deployed contracts (network inferred from
address prefix), or globs.

```bash
secondlayer codegen contracts ./contracts/token.clar -o ./src/generated.ts
secondlayer codegen contracts SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.alex-vault -o ./src/generated.ts
secondlayer codegen contracts "./contracts/*.clar" -o ./src/generated.ts
secondlayer codegen contracts --watch   # regenerate on .clar / config / Clarinet.toml changes
```

Config-driven:

```bash
# write a secondlayer.config.ts, then:
secondlayer codegen contracts  # regenerates from the config
```

```typescript
// secondlayer.config.ts
import { defineConfig } from "@secondlayer/cli"
import { clarinet, react } from "@secondlayer/cli/plugins"

export default defineConfig({
  out: "src/generated.ts",
  plugins: [clarinet(), react()],
})
```

| Plugin | What it adds |
|---|---|
| `clarinet()` | Parse local Clarinet project — includes `[project.requirements]` dependency contracts too (`includeRequirements: false` to opt out) |
| `react()` | Typed React Query hooks |
| `testing()` | Clarinet SDK test helpers |

Generated output includes named per-function type aliases (`TokenTransferArgs`,
`TokenTransferResult`), a `TokenTypes` bundle, and a `tokenAbi` const branded
with `TypedAbi` — `getContract` from `@secondlayer/stacks` picks up the brand
so hovers and type errors show the named aliases instead of expanded inline
types.

```typescript
import { token } from "./generated/contracts"

// Generated call descriptors compose with any tx builder:
await makeContractCall({
  ...token.transfer({ amount: 100n, recipient: "SP..." }),
  network: "mainnet",
})

// Maps/vars/constants accessors are built in:
const supply = await token.vars.totalSupply.get()
```

## Frozen commands

Local-dev periphery: still functional, hidden from `secondlayer --help`, no further
investment — may be removed in a future major. `secondlayer subgraphs
create/deploy` against your own instance is the supported path.

- `secondlayer local up/down/start/stop/restart/status/logs` — local stack + dev services
- `secondlayer local node ...` — local Stacks node management
- `secondlayer local db ...` — local source DB inspection
- `secondlayer devnet connect/down/status/logs` — Clarinet devnet integration

## Docs

Full reference: https://secondlayer.tools/docs

## License

MIT
