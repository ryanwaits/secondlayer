# @secondlayer/cli

The Secondlayer CLI — one binary for Stacks indexing, real-time subgraphs,
subscriptions, and Clarity code generation.

```bash
bun add -g @secondlayer/cli
sl --version
```

## Auth

Two ways to authenticate:

- **Interactive (`sl login`)** — magic-link email → 6-digit code → session
  written to `~/.secondlayer/session.json`. Used for day-to-day CLI work.
- **Machine / CI** — set `SL_API_KEY` to an API key created in the platform
  console at https://secondlayer.tools/platform/api-keys. Keys are prefixed
  `sk-sl_`. For a persisted headless login: `echo "$SL_API_KEY" | sl login --with-token`.

```bash
# interactive
sl login

# machine / CI
export SL_API_KEY=sk-sl_xxxxxxxx
```

`sl whoami` shows the active account, the effective API URL, and the credential
source (and exits non-zero when not logged in). The global `--api-key` /
`--api-url` flags (and `SL_API_KEY` / `SL_API_URL`) apply to every command.

During open beta, reads are public (no key needed). Writes — deploying or
managing subgraphs and subscriptions — require a session or an `sk-sl_` key.

## Quickstart

```bash
bun add -g @secondlayer/cli
sl login
sl projects create my-app
sl projects use my-app

# scaffold + deploy a subgraph from a deployed contract
sl subgraphs scaffold SP1234ABCD.my-contract -o subgraphs/my-contract.ts
sl subgraphs deploy subgraphs/my-contract.ts --start-block <recent-block>
sl subgraphs query my-contract <table> --sort _block_height --order desc

# wire a webhook receiver
sl subscriptions create my-hook \
  --runtime node \
  --subgraph my-contract \
  --table <table> \
  --url https://<receiver-host>/webhook
```

`sl subgraphs scaffold` writes the definition file, creates/updates
`package.json`, and runs `bun install` (pass `--no-install` to skip).

## Commands

### Auth & project

| Command | What it does |
|---|---|
| `sl login` / `sl logout` | Start or revoke a session |
| `sl whoami` | Print account, credential source, and active project |
| `sl keys create --product streams [--name <name>]` | Mint a scoped `streams`/`index` read key; prints the `sk-sl_` key **once**. Needs an account key in `SL_API_KEY` |
| `sl projects create [name]` | Create a project |
| `sl projects list` | List projects |
| `sl projects use <slug>` | Bind cwd to a project (writes `./.secondlayer/project`) |
| `sl projects get` | Show resolved project + source file |
| `sl projects delete <slug>` (alias `rm`) | Delete a project (`-y` to skip confirm) |

Project binding is per-directory: `.secondlayer/project` in cwd takes
precedence over `~/.secondlayer/config.json:defaultProject`. The walk-up stops
at `.git`.

**Key products:** an `account` key (dashboard default) grants both `streams:read`
and `index:read` and is the only key that can mint; `streams`/`index` keys are
scoped reads and cannot mint (403). Minted keys inherit your plan's tier.

### Subgraphs

| Command | What it does |
|---|---|
| `sl subgraphs create <name>` | Scaffold a definition file |
| `sl subgraphs scaffold <SP...::contract> [-o <path>] [--no-install]` | Generate a subgraph from a deployed contract |
| `sl subgraphs deploy <file> [--start-block <n>]` | Deploy; `--start-block` overrides the definition |
| `sl subgraphs dev <file>` | Watch + hot-redeploy |
| `sl subgraphs query <name> <table>` | Query a table with filters, sort, pagination |
| `sl subgraphs list` / `status <name>` / `gaps <name>` | Inspect deployments |
| `sl subgraphs spec <nameOrFile> [--format openapi\|agent\|markdown]` | Export API docs for a deployed subgraph or a local definition file |
| `sl subgraphs deploy <file> --database-url <url>` | BYO: write the subgraph's rows to your own Postgres |
| `sl subgraphs codegen <file> --target prisma\|drizzle [-o <path>]` | Generate an ORM schema for the subgraph's tables (BYO DB) |
| `sl subgraphs client <name> -o <path>` | Generate a typed query client for a deployed subgraph |
| `sl subgraphs reindex/backfill/cancel/delete <name>` | Manage processing |

### Data products (reads)

| Command | What it does |
|---|---|
| `sl datasets list` / `query <dataset> [--filter k=v] [--cursor] [--limit] [--json]` | Foundation Datasets (sBTC, BNS, PoX-4, STX transfers). Public — no key |
| `sl index ft-transfers` / `nft-transfers` / `events --event-type <t>` / `contract-calls` | Decoded L2 layer. Anonymous reads OK; free-tier keys rejected (Build+ for keyed) |
| `sl streams tip` / `events` / `consume` / `reorgs` / `canonical <h>` / `pull` | Raw L1 event firehose. **Requires `SL_API_KEY`** |

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

### Local dev & OSS

| Command | What it does |
|---|---|
| `sl local up [--devnet]` / `sl local down [--devnet]` | Start/stop the full local stack (Stacks node + dev services), or a Clarinet devnet |
| `sl local start/stop/restart/status/logs` | Manage just the local dev services |
| `sl local node setup/start/stop/...` | Manage the local Stacks node |
| `sl local db blocks/txs/events/gaps/truncate/resync` | Inspect the local source DB |
| `sl devnet connect/down/status/logs` | Clarinet devnet integration |

### Other

| Command | What it does |
|---|---|
| `sl contracts generate [files...]` (alias `gen`) | Generate TS interfaces from Clarity contracts |
| `sl context` | Print a headless orientation snapshot — account, Streams + Index tips, your subgraphs, subscriptions, and in-flight reindex operations. CLI counterpart to the MCP `secondlayer://context` resource |
| `sl init` | Scaffold `secondlayer.config.ts` |
| `sl doctor` / `sl status` | Reachability + health checks |
| `sl account get` / `sl account update` | Show or update display name / bio / slug |
| `sl account billing` | Show plan, subscription, trial, discounts |
| `sl config get/set/reset/delete` | Inspect or reset local config |

## Environment variables

| Var | Purpose |
|---|---|
| `SL_API_KEY` | An `sk-sl_` API key (or session token) for machine/CI use; bypasses platform resolution |
| `SL_API_URL` | Point at an OSS or internal API directly, bypassing the platform |
| `SL_PLATFORM_API_URL` | Override the platform API base (default `https://api.secondlayer.tools`) |
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
```

Config-driven:

```bash
sl init                # creates secondlayer.config.ts
sl contracts generate  # regenerates from the config
```

```typescript
// secondlayer.config.ts
import { defineConfig } from "@secondlayer/cli"
import { clarinet, actions, react } from "@secondlayer/cli/plugins"

export default defineConfig({
  out: "src/generated.ts",
  plugins: [clarinet(), actions(), react()],
})
```

| Plugin | What it adds |
|---|---|
| `clarinet()` | Parse local Clarinet project |
| `actions()` | `read.*` + `write.*` helpers per contract |
| `react()` | Typed React Query hooks |
| `testing()` | Clarinet SDK test helpers |

```typescript
import { token } from "./generated/contracts"

// Works with @stacks/transactions directly:
await makeContractCall({
  ...token.transfer({ amount: 100n, recipient: "SP..." }),
  network: "mainnet",
})

// With actions() — read/write helpers + maps/vars/constants:
const balance = await token.read.getBalance({ account: "SP..." })
await token.write.transfer({ amount: 100n, recipient: "SP..." })
const supply = await token.vars.totalSupply.get()
```

## Docs

Full reference: https://secondlayer.tools/docs

## License

MIT
