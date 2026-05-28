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
- **Machine / CI** — set `SL_SERVICE_KEY` to an API key created in the platform
  console at https://secondlayer.tools/platform/api-keys. Keys are prefixed
  `sk-sl_`.

```bash
# interactive
sl login

# machine / CI
export SL_SERVICE_KEY=sk-sl_xxxxxxxx
```

During open beta, reads are public (no key needed). Writes — deploying or
managing subgraphs and subscriptions — require a session or an `sk-sl_` key.

## Quickstart

```bash
bun add -g @secondlayer/cli
sl login
sl project create my-app
sl project use my-app

# scaffold + deploy a subgraph from a deployed contract
sl subgraphs scaffold SP1234ABCD.my-contract -o subgraphs/my-contract.ts
sl subgraphs deploy subgraphs/my-contract.ts --start-block <recent-block>
sl subgraphs query my-contract <table> --sort _block_height --order desc

# wire a webhook receiver
sl create subscription my-hook \
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
| `sl whoami` | Print account + active project |
| `sl project create [name]` | Create a project |
| `sl project list` | List projects |
| `sl project use <slug>` | Bind cwd to a project (writes `./.secondlayer/project`) |
| `sl project current` | Show resolved project + source file |

Project binding is per-directory: `.secondlayer/project` in cwd takes
precedence over `~/.secondlayer/config.json:defaultProject`. The walk-up stops
at `.git`.

### Subgraphs

| Command | What it does |
|---|---|
| `sl subgraphs new <name>` | Scaffold a definition file |
| `sl subgraphs scaffold <SP...::contract> [-o <path>] [--no-install]` | Generate a subgraph from a deployed contract |
| `sl subgraphs deploy <file> [--start-block <n>]` | Deploy; `--start-block` overrides the definition |
| `sl subgraphs dev <file>` | Watch + hot-redeploy |
| `sl subgraphs query <name> <table>` | Query a table with filters, sort, pagination |
| `sl subgraphs list` / `status <name>` / `gaps <name>` | Inspect deployments |
| `sl subgraphs spec <name> [--format openapi\|agent\|markdown]` | Export API docs for a deployed subgraph |
| `sl subgraphs inspect <file> [--format ...]` | Same docs from a local definition before deploy |
| `sl subgraphs deploy <file> --database-url <url>` | BYO: write the subgraph's rows to your own Postgres |
| `sl subgraphs codegen <file> --target prisma\|drizzle [-o <path>]` | Generate an ORM schema for the subgraph's tables (BYO DB) |
| `sl subgraphs reindex/backfill/stop/delete/generate <name>` | Manage processing + types |

### Subscriptions

`sl create subscription` scaffolds a receiver project. `sl subscriptions ...`
manages existing ones.

| Command | What it does |
|---|---|
| `sl create subscription <name> --runtime <inngest\|trigger\|cloudflare\|node> [--auth-token <token>] [--filter key=value]` | Scaffold a receiver wired to a new subscription |
| `sl subscriptions list` / `get <id\|name>` | List or show config + delivery state |
| `sl subscriptions update <id\|name> --url <url> [--filter key.gte=value]` | Patch URL, filter, format, retry, etc. |
| `sl subscriptions pause/resume <id\|name>` | Stop or restart delivery |
| `sl subscriptions rotate-secret <id\|name>` | Rotate signing secret (printed once) |
| `sl subscriptions deliveries/dead <id\|name>` | Recent attempts / dead-letter rows |
| `sl subscriptions requeue <id\|name> <outboxId>` | Requeue one dead-letter row |
| `sl subscriptions replay <id\|name> --from-block <n> --to-block <n>` | Enqueue a historical block range |
| `sl subscriptions doctor/test <id\|name>` | Health check / signed fixture |

Read/action commands support `--json`. Destructive commands prompt unless
`--yes`. Filters are schema-aware: unknown tables/columns, bad operators, and
non-scalar columns are rejected before the API call.

### Local dev & OSS

| Command | What it does |
|---|---|
| `sl local start/stop/restart/status/logs` | Manage the local Docker stack |
| `sl local node setup/start/stop/...` | Manage the local Stacks node |
| `sl stack start/stop/restart` | Alias for `sl local` |
| `sl db blocks/txs/events/gaps/reset/resync` | Inspect the local source DB |

### Other

| Command | What it does |
|---|---|
| `sl generate [files...]` (aliases `gen`, `codegen`) | Generate TS interfaces from Clarity contracts |
| `sl init` | Scaffold `secondlayer.config.ts` |
| `sl doctor` / `sl status` | Reachability + health checks |
| `sl account profile` | Update display name / bio / slug |
| `sl config show/set/reset/clear` | Inspect or reset local config |

## Environment variables

| Var | Purpose |
|---|---|
| `SL_SERVICE_KEY` | An `sk-sl_` API key (or session token) for machine/CI use; bypasses platform resolution. `SECONDLAYER_API_KEY` is a deprecated alias |
| `SL_API_URL` | Point at an OSS or internal API directly, bypassing the platform |
| `SL_PLATFORM_API_URL` | Override the platform API base (default `https://api.secondlayer.tools`) |
| `STACKS_NETWORK` | Default network (also via `--network <local\|testnet\|mainnet>`) |
| `HIRO_API_KEY` | Used by `sl generate` for remote contract fetches |

## Code generation (`sl generate`)

Generate type-safe interfaces, functions, and optional React hooks from Clarity
contracts — local `.clar` files, deployed contracts (network inferred from
address prefix), or globs.

```bash
sl generate ./contracts/token.clar -o ./src/generated.ts
sl generate SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.alex-vault -o ./src/generated.ts
sl generate "./contracts/*.clar" -o ./src/generated.ts
```

Config-driven:

```bash
sl init        # creates secondlayer.config.ts
sl generate    # regenerates from the config
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
