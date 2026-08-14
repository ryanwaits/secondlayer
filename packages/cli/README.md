# @secondlayer/cli

The Secondlayer CLI — one binary for Stacks indexing, real-time subgraphs,
subscriptions, and Clarity code generation.

```bash
bun add -g @secondlayer/cli
sl --version
```

## Auth

Default API is `http://127.0.0.1:3800`. Override with `SL_API_URL`.

Writes against a published bind use `INSTANCE_TOKEN` from `sl init` as
`SL_API_KEY`. Loopback reads need no token.

```bash
export SL_API_URL=http://127.0.0.1:3800
export SL_API_KEY=<INSTANCE_TOKEN>
```

## Quickstart

```bash
bun add -g @secondlayer/cli
sl init --network mainnet
sl start --print
# docker compose -f docker/oss/docker-compose.yml up -d

sl subgraphs scaffold SP1234ABCD.my-contract -o subgraphs/my-contract.ts
sl subgraphs deploy subgraphs/my-contract.ts --start-block <recent-block>
sl subgraphs query my-contract <table> --sort _block_height --order desc
```

`sl subgraphs scaffold` writes the definition file, creates/updates
`package.json`, and runs `bun install` (pass `--no-install` to skip).

## Commands

### Local runtime

No account. Writes `.env.local`, restores history, prints the Stacks observer stanza.

| Command | What it does |
|---|---|
| `sl init [--network mainnet\|testnet\|devnet] [--api-url <url>] [--force]` | Write `.env.local` (token, secrets key, webhook signing key). Idempotent |
| `sl start [--print]` | Validate one-box config and print `docker compose up` |
| `sl bootstrap --against <manifest> [--to-block <n>] [--public-key <pem>] [-y] [--json]` | Restore chain history from a verified archive into an empty database. Exit `0` restored, `1` diverged, `2` refused |
| `sl observer [--mode indexer\|signer-shared] [--endpoint host:port] [--recovery journal\|archive] [--network …]` | Print the `[[events_observer]]` stanza. Signer-shared requires `--recovery` |
| `sl verify [all\|raw\|decode:<name>\|subgraph:<name>] --against <manifest> [--quick\|--deep\|--anchor]` | Compare local data to a signed archive. Default target `raw`. Exit `0` clean, `1` diverged, `2` unanchored |
| `sl repair --against <archive> [--apply]` | Plan (default) or apply an archive repair |

### Subgraphs

| Command | What it does |
|---|---|
| `sl subgraphs create <name>` | Scaffold a definition file |
| `sl subgraphs scaffold <SP...::contract> [-o <path>] [--no-install]` | Generate a subgraph from a deployed contract |
| `sl subgraphs deploy <file> [--start-block <n>] [--visibility public\|private]` | Deploy; `--start-block` overrides the definition. Managed deploys default `public`, BYO default `private` |
| `sl subgraphs list` | List deployments (`ls` alias) |
| `sl subgraphs dev <file>` | Watch + hot-redeploy |
| `sl subgraphs query <name> <table>` | Query a table with filters, sort, pagination |
| `sl subgraphs status <name>` / `gaps <name>` | Inspect a deployment |
| `sl subgraphs spec <nameOrFile> [--format openapi\|agent\|markdown]` | Export API docs for a deployed subgraph or a local definition file |
| `sl subgraphs deploy <file> --database-url <url>` | BYO: write the subgraph's rows to your own Postgres |
| `sl subgraphs codegen <file> --target prisma\|drizzle [-o <path>]` | Generate an ORM schema for the subgraph's tables (BYO DB) |
| `sl subgraphs client <name> -o <path>` | Generate a typed query client for a deployed subgraph |
| `sl subgraphs reindex/backfill/cancel/delete <name>` | Manage processing |

### Data products (reads)

| Command | What it does |
|---|---|
| `sl index ft-transfers` / `nft-transfers` / `events --event-type <t>` / `contract-calls` | Decoded Index layer. Anonymous reads OK; free-tier keys rejected (Build+ for keyed) |
| `sl streams tip` / `events` / `consume` / `reorgs` / `canonical <h>` / `pull` | Raw chain event firehose. **Requires `SL_API_KEY`** |

Reads emit JSON to stdout (`--json` accepted across all read commands); `-o/--output` is a file path, not a format.

### Subscriptions

| Command | What it does |
|---|---|
| `sl subscriptions create <name> --runtime <inngest\|trigger\|cloudflare\|node> [--auth-token <token>] [--filter key=value]` | Scaffold a receiver wired to a new subscription |
| `sl subscriptions list` / `get <id\|name>` | List or show config + delivery state |
| `sl subscriptions update <id\|name> --url <url> [--filter key.gte=value]` | Patch URL, filter, format, retry, etc. |
| `sl subscriptions pause/resume <id\|name>` | Stop or restart delivery |
| `sl subscriptions rotate-secret <id\|name>` | Rotate signing secret (printed once) |
| `sl subscriptions deliveries/dead <id\|name>` | Recent attempts / dead-letter rows |
| `sl subscriptions requeue <id\|name> <outboxId>` | Requeue one dead-letter row |
| `sl subscriptions replay <id\|name> --from-block <n> --to-block <n>` | Enqueue a historical block range |
| `sl subscriptions doctor/test <id\|name>` | Health check / signed fixture |

Read/action commands support `--json`. Destructive commands prompt unless
`-y` / `--yes`. Filters are schema-aware: unknown tables/columns, bad operators,
and non-scalar columns are rejected before the API call.

Subscriptions are polymorphic — **subgraph** (fires on a subgraph table's rows)
or **chain** (fires on raw chain events with no subgraph). `sl subscriptions
create` makes subgraph subscriptions only (via the `--subgraph`/`--table`
flags). Create chain subscriptions — a webhook on a contract / event / function /
trait — via the SDK, REST, or MCP with a `triggers` array. Every other
`sl subscriptions` command (list/get/update/pause/resume/delete/doctor/test/
deliveries/...) operates on both kinds.

### Other

| Command | What it does |
|---|---|
| `sl contracts generate [files...]` (alias `gen`) | Generate TS interfaces from Clarity contracts |
| `sl context` | Instance snapshot — Streams + Index tips, subgraphs, subscriptions |
| `sl doctor` / `sl status` | Reachability + health checks |
| `sl config get/set/reset/delete` | Inspect or reset local config |

## Environment variables

| Var | Purpose |
|---|---|
| `SL_API_KEY` | `INSTANCE_TOKEN` from `sl init` for writes. Loopback reads need no token |
| `SL_API_URL` | Instance API. Default `http://127.0.0.1:3800` |
| `SL_PLATFORM_API_URL` | Alias of `SL_API_URL` |
| `STACKS_NETWORK` | Default network (also via `--network <local\|testnet\|mainnet>`) |
| `HIRO_API_KEY` | Used by `sl contracts generate` for remote contract fetches |

## Code generation (`sl contracts generate`)

Generate type-safe interfaces, functions, and optional React hooks from Clarity
contracts — local `.clar` files, deployed contracts (network inferred from
address prefix), or globs.

```bash
sl contracts generate ./contracts/token.clar -o ./src/generated.ts
sl contracts generate SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.alex-vault -o ./src/generated.ts
sl contracts generate "./contracts/*.clar" -o ./src/generated.ts
sl contracts generate --watch   # regenerate on .clar / config / Clarinet.toml changes
```

Config-driven:

```bash
# write a secondlayer.config.ts, then:
sl contracts generate  # regenerates from the config
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

Local-dev periphery: still functional, hidden from `sl --help`, no further
investment — may be removed in a future major. The hosted dev loop
(`sl subgraphs create/deploy`) is the supported path.

- `sl local up/down/start/stop/restart/status/logs` — local stack + dev services
- `sl local node ...` — local Stacks node management
- `sl local db ...` — local source DB inspection
- `sl devnet connect/down/status/logs` — Clarinet devnet integration

## Docs

Full reference: https://secondlayer.tools/docs

## License

MIT
