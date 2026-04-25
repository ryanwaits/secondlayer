# @secondlayer/cli

The Secondlayer CLI — one binary for dedicated Stacks indexing, real-time
subgraphs, and per-tenant hosting lifecycle.

```bash
bun add -g @secondlayer/cli
sl --version
```

## Quickstart

```bash
sl login                         # magic-link auth, session cached at ~/.secondlayer/session.json
sl project create my-app         # scaffold a project
sl project use my-app            # bind cwd to the project (writes ./.secondlayer/project)
sl instance create --plan launch # provision dedicated Postgres + API + processor
sl subgraphs deploy ./x.ts       # deploy to your instance
```

## Command surface

### Auth (top-level)

| Command | What it does |
|---|---|
| `sl login` | Magic-link email → 6-digit code → writes session to `~/.secondlayer/session.json` |
| `sl logout` | Revokes the session and clears the local file |
| `sl whoami` | Prints account, active project, instance URL, plan, status |

### Project

Projects are the unit that binds a working directory to a dedicated instance.
Binding is **per-directory** — `.secondlayer/project` in cwd takes precedence
over the global default at `~/.secondlayer/config.json:defaultProject`. The
walk-up stops at `.git` (never crosses repos).

| Command | What it does |
|---|---|
| `sl project create [name]` | Scaffold a new project on the platform |
| `sl project list` | List all projects for the account |
| `sl project use <slug>` | Write `./.secondlayer/project` — binds cwd to that project |
| `sl project current` | Prints the resolved slug + the file it was read from |

### Instance (dedicated hosting)

One instance per project. The platform API spawns a dedicated `sl-pg-{slug}`,
`sl-api-{slug}`, and `sl-proc-{slug}` container set on the hosting side.

| Command | What it does |
|---|---|
| `sl instance create --plan <launch\|grow\|scale>` | Provision containers. Boxed reveal of `serviceKey` + `anonKey` (shown once). |
| `sl instance info` | Plan, status, resource usage |
| `sl instance resize --plan <...>` | Recreate containers with new CPU/memory (~30s downtime) |
| `sl instance suspend` / `resume` | Stop/start containers, volume preserved |
| `sl instance keys rotate [--service\|--anon\|--both]` | Bump JWT gen, recreate API container, mint replacement key(s) |
| `sl instance delete` | Typed-slug confirm, hard teardown |
| `sl instance db` | Print `ssh -L` command + `DATABASE_URL` for tunneled Postgres access |
| `sl instance db add-key <path>` | Upload an SSH pubkey to the bastion |
| `sl instance db revoke-key` | Revoke your bastion access |

### Create (scaffolders)

| Command | What it does |
|---|---|
| `sl create subscription <name> --runtime <inngest\|trigger\|cloudflare\|node> [--auth-token <token>] [--filter key=value]` | Scaffold a receiver project wired to a new subscription. Copies the runtime template into `./<name>/`, provisions through the active project/instance, supports scalar filters and bearer auth, and wires the signing secret so the dev server starts consuming events immediately. |

### Subscriptions (tenant-scoped)

`sl create subscription` is the receiver scaffolder. `sl subscriptions ...` is
the operational surface for existing subscriptions. All commands resolve the
active project/instance the same way as `sl subgraphs ...`; `SL_API_URL` and
`SL_SERVICE_KEY` still bypass platform resolution for OSS or CI.

| Command | What it does |
|---|---|
| `sl subscriptions list` | List subscriptions with status, target table, format, and last success |
| `sl subscriptions get <id\|name>` | Show full config, filter, retry/circuit state |
| `sl subscriptions update <id\|name> --url <url> [--auth-token <token>] [--filter key.gte=value]` | Patch URL, bearer auth, filter, format, runtime, retry, timeout, concurrency |
| `sl subscriptions pause/resume <id\|name>` | Stop or restart delivery |
| `sl subscriptions rotate-secret <id\|name>` | Rotate signing secret and print the new value once |
| `sl subscriptions deliveries <id\|name>` | Last 100 delivery attempts |
| `sl subscriptions dead <id\|name>` | Dead-letter rows |
| `sl subscriptions requeue <id\|name> <outboxId>` | Requeue one dead-letter row |
| `sl subscriptions replay <id\|name> --from-block <n> --to-block <n>` | Enqueue historical rows from a block range |
| `sl subscriptions doctor <id\|name>` | Config, circuit state, recent delivery health, linked subgraph gaps, next-step hints |
| `sl subscriptions test <id\|name> --signing-secret <secret> [--post]` | Build a signed Standard Webhooks fixture from the latest row or a synthetic row |

Read/action commands support `--json`. Destructive commands prompt unless
`--yes` is passed. CLI filters are schema-aware: unknown tables, unknown
columns, unsupported operators, and non-scalar columns are rejected before the
API call; the server repeats the same validation as the source of truth.

### Subgraphs (tenant-scoped)

All tenant-scoped commands auto-mint a 5-minute ephemeral service JWT per
invocation. No long-lived key on disk.

| Command | What it does |
|---|---|
| `sl subgraphs new <name>` | Scaffold a subgraph definition file |
| `sl subgraphs deploy <file> [--start-block <n>]` | Deploy to the active instance; `--start-block` overrides the definition start block for that deploy |
| `sl subgraphs dev <file>` | Watch + hot-redeploy |
| `sl subgraphs list` | List deployed subgraphs |
| `sl subgraphs status <name>` | Indexing progress, row counts, gaps |
| `sl subgraphs query <name> <table>` | Query a subgraph table with filters, sort, pagination |
| `sl subgraphs reindex <name>` | Drop + re-process from the tip backwards |
| `sl subgraphs backfill <name>` | Fill a specific block range |
| `sl subgraphs stop <name>` | Pause processing |
| `sl subgraphs gaps <name>` | List missing block ranges |
| `sl subgraphs delete <name>` | Drop the subgraph + its schema |
| `sl subgraphs scaffold <SP...::contract>` | Generate a starter subgraph from a deployed contract |
| `sl subgraphs generate <name>` | Regenerate TS types for an existing subgraph |

### Local dev + OSS

| Command | What it does |
|---|---|
| `sl local start/stop/restart/status/logs` | Manage the local Docker stack |
| `sl local node setup/start/stop/...` | Manage the local Stacks node |
| `sl stack start/stop/restart` | Alias for `sl local` |
| `sl db blocks/txs/events/gaps/reset/resync` | Inspect the local source DB |

### Other

| Command | What it does |
|---|---|
| `sl generate [files...]` (aliases: `gen`, `codegen`) | Generate TS interfaces from Clarity contracts |
| `sl init` | Scaffold `secondlayer.config.ts` |
| `sl doctor` | Session + project + instance reachability check |
| `sl status` | Platform/instance health |
| `sl account profile` | Update display name / bio / slug |
| `sl config show/set/reset/clear` | Inspect or reset local config |

## Environment variables

| Var | Purpose |
|---|---|
| `SL_API_URL` | Bypass platform resolution — point at an OSS or internal API directly |
| `SL_SERVICE_KEY` | Service key when using env-var bypass |
| `SL_PLATFORM_API_URL` | Override the platform API base (default `https://api.secondlayer.tools`) |
| `STACKS_NETWORK` | Override via `--network <local\|testnet\|mainnet>` |
| `HIRO_API_KEY` | Used by `sl generate` for remote contract fetches |

## Error codes

Every tenant-scoped failure surfaces a typed code and an action hint:

| Code | CLI hint |
|---|---|
| `SESSION_EXPIRED` | `Session expired. Run: sl login` |
| `TENANT_SUSPENDED` | `Instance is suspended. Run: sl instance resume` |
| `NO_ACTIVE_PROJECT` | `No project selected. Run: sl project use <slug>` |
| `NO_TENANT_FOR_PROJECT` | `Project has no instance. Run: sl instance create --plan launch` |
| `KEY_ROTATED` | Handled transparently — `http.ts` re-mints and retries once |

## Code generation (`sl generate`)

Generate type-safe interfaces, functions, and optional React hooks from
Clarity contracts — works against local `.clar` files, deployed contracts
(network inferred from address prefix), or glob patterns.

```bash
# Local .clar files
sl generate ./contracts/token.clar -o ./src/generated.ts

# Deployed contracts (SP/SM → mainnet, ST/SN → testnet)
sl generate SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.alex-vault -o ./src/generated.ts

# Glob
sl generate "./contracts/*.clar" -o ./src/generated.ts
```

Config-driven mode:

```bash
sl init          # creates secondlayer.config.ts
sl generate      # regenerates from the config
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

### Plugins

| Plugin | What it adds |
|---|---|
| `clarinet()` | Parse local Clarinet project |
| `actions()` | `read.*` + `write.*` helpers on each contract |
| `react()` | Typed React Query hooks (`useTokenTransfer`, `useTokenBalance`, etc.) |
| `testing()` | Clarinet SDK test helpers |

### Usage examples

```typescript
import { token } from "./generated/contracts"
import { makeContractCall, fetchCallReadOnlyFunction } from "@stacks/transactions"

// Works with @stacks/transactions directly:
await makeContractCall({
  ...token.transfer({ amount: 100n, recipient: "SP..." }),
  network: "mainnet",
})

// With actions() plugin — read/write helpers:
const balance = await token.read.getBalance({ account: "SP..." })
await token.write.transfer({ amount: 100n, recipient: "SP..." })

// Maps / vars / constants:
const supply = await token.vars.totalSupply.get()
const bal = await token.maps.balances.get("SP...")
const max = await token.constants.maxSupply.get()
```

```typescript
// With react() plugin:
import { useTokenTransfer, useTokenBalance } from "./generated/hooks"

function App() {
  const { transfer, isRequestPending } = useTokenTransfer()
  const { data: balance } = useTokenBalance("SP...")
  // ...
}
```

## License

MIT
