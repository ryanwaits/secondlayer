# Installation & setup

Everything you need to install one or more Secondlayer packages, authenticate the CLI, and get a project bound to your working directory.

## Packages

| Package | Install | What it's for |
|---|---|---|
| `@secondlayer/cli` | `bun add -g @secondlayer/cli` | The `secondlayer` binary. Auth, project management, subgraph deploy/query, subscription CRUD, streams, local dev, codegen. |
| `@secondlayer/sdk` | `bun add @secondlayer/sdk` | TypeScript client for the Secondlayer platform API: `sl.streams`, `sl.index`, `sl.subgraphs`, `sl.subscriptions`. Webhook signature verification. |
| `@secondlayer/subgraphs` | `bun add @secondlayer/subgraphs` | Author-side library for writing subgraph definitions (`defineSubgraph`, types, triggers). |
| `@secondlayer/stacks` | `bun add @secondlayer/stacks` | viem-style Stacks chain client. Reads + signs txs. `Cl`, `Pc`, `getContract`, BNS / PoX / sBTC / StackingDAO. |
| `@secondlayer/mcp` | `bun add -d @secondlayer/mcp` | MCP server for agents to manage subgraphs/subscriptions without shelling out. |

Pick only the packages your task needs. They have no shared runtime — each is independently installable.

> Bun is the assumed package manager (most Secondlayer projects declare `"packageManager": "bun@..."`). `npm` / `pnpm` work too — substitute the equivalent command if the user's project uses one.

## Verify the install

```bash
secondlayer --version
```

`sl` is a short alias of `secondlayer`.

If `secondlayer` is not found after `bun add -g @secondlayer/cli`, ensure Bun's global bin directory is on `PATH`:

```bash
# Add to ~/.zshrc or ~/.bashrc
export PATH="$HOME/.bun/bin:$PATH"
```

## Start a local instance

```bash
secondlayer init --network mainnet
secondlayer start --print
# docker compose -f docker/oss/docker-compose.yml up -d
```

`secondlayer init` writes `.env.local` (`INSTANCE_TOKEN`, secrets key, webhook signing key). Loopback reads need no token. For writes against a published bind:

```bash
export SL_API_URL=http://127.0.0.1:3800
export SL_API_KEY=<INSTANCE_TOKEN>
```

`--api-key <key>` and `--api-url <url>` are global flags available on every command, overriding `SL_API_KEY` / `SL_API_URL` for that one invocation.

## Environment variables

| Variable | Read by | Purpose |
|---|---|---|
| `SL_API_URL` | All SDK + CLI calls | Override instance API. Default: `http://127.0.0.1:3800`. |
| `SL_API_KEY` | CLI writes, MCP, SDK | `INSTANCE_TOKEN` from `secondlayer init`. Loopback reads need no token. |
| `HIRO_API_KEY` | `secondlayer codegen contracts`, `secondlayer subgraphs scaffold` | Stacks node API key for ABI fetches against Hiro RPC. |
| `SIGNING_SECRET` | `secondlayer subscriptions test` fallback | If `--signing-secret` not passed. |
| `STACKS_NETWORK` | `secondlayer codegen contracts` and some local commands | `local`, `testnet`, or `mainnet`. |
| `SECONDLAYER_API_KEY` (in user code) | `new SecondLayer({ apiKey })` | What the SDK reads in your own code if you don't pass `apiKey` explicitly. (Naming is your choice; SDK takes the value via constructor.) |

## SDK quickstart

```typescript
import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer(); // http://127.0.0.1:3800 or SL_API_URL

const tip = await sl.streams.tip();
const { data } = await sl.subgraphs.list();
```

Loopback reads need no key. History is whatever this instance has bootstrapped. Writes (`sl.subgraphs.deploy`, `sl.subscriptions.create`, …) use `INSTANCE_TOKEN` as `apiKey` when the API is bound beyond loopback. Public Streams dumps (`client.dumps`, `events.replay`) need no instance key.

## Stacks client quickstart

```typescript
import { createPublicClient, http, mainnet } from "@secondlayer/stacks";

const client = createPublicClient({
  chain: mainnet,
  transport: http(),
});

const balance = await client.getBalance({
  address: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
});
```

For signing transactions you need a wallet client + an account. See `references/stacks.md`.

## Project layout convention

A typical Secondlayer project:

```
my-app/
├── .secondlayer/
│   └── project              # Binds this dir to a project (created by `secondlayer projects use`)
├── subgraphs/
│   ├── token-transfers.ts   # defineSubgraph(...) modules
│   └── contract-events.ts
├── src/
│   └── ...                  # Your app code, imports @secondlayer/sdk / @secondlayer/stacks
├── package.json             # Deps on @secondlayer/sdk, @secondlayer/subgraphs, @secondlayer/stacks
└── .env.local               # INSTANCE_TOKEN, SL_API_URL, SIGNING_SECRET, ...
```

Subgraph files live under `subgraphs/` by convention but the CLI accepts any path: `secondlayer subgraphs deploy any/path/file.ts`.

## Upgrading

```bash
bun add -g @secondlayer/cli@latest
bun add @secondlayer/sdk@latest @secondlayer/subgraphs@latest @secondlayer/stacks@latest
```

Major versions occasionally change `defineSubgraph` payload shapes or extension method signatures. Always re-run `secondlayer subgraphs spec <file>` after a `@secondlayer/subgraphs` major bump to confirm your handlers still type-check.
