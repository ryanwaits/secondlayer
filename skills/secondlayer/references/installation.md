# Installation & setup

Everything you need to install one or more Secondlayer packages, authenticate the CLI, and get a project bound to your working directory.

## Packages

| Package | Install | What it's for |
|---|---|---|
| `@secondlayer/cli` | `bun add -g @secondlayer/cli` | The `sl` binary. Auth, project management, subgraph deploy/query, subscription CRUD, streams, local dev, codegen. |
| `@secondlayer/sdk` | `bun add @secondlayer/sdk` | TypeScript client for the Secondlayer platform API: `sl.streams`, `sl.index`, `sl.subgraphs`, `sl.subscriptions`. Webhook signature verification. |
| `@secondlayer/subgraphs` | `bun add @secondlayer/subgraphs` | Author-side library for writing subgraph definitions (`defineSubgraph`, types, triggers). |
| `@secondlayer/stacks` | `bun add @secondlayer/stacks` | viem-style Stacks chain client. Reads + signs txs. `Cl`, `Pc`, `getContract`, BNS / PoX / sBTC / StackingDAO. |
| `@secondlayer/mcp` | `bun add -d @secondlayer/mcp` | MCP server for agents to manage subgraphs/subscriptions without shelling out. |

Pick only the packages your task needs. They have no shared runtime — each is independently installable.

> Bun is the assumed package manager (most Secondlayer projects declare `"packageManager": "bun@..."`). `npm` / `pnpm` work too — substitute the equivalent command if the user's project uses one.

## Verify the install

```bash
sl --version
```

If `sl` is not found after `bun add -g @secondlayer/cli`, ensure Bun's global bin directory is on `PATH`:

```bash
# Add to ~/.zshrc or ~/.bashrc
export PATH="$HOME/.bun/bin:$PATH"
```

## Authenticate the CLI

```bash
sl login
```

Flow: prompts for email → mails a 6-digit code → prompts for the code → writes `~/.secondlayer/session.json` (token, email, accountId, expiresAt). The server auto-extends the session on every subsequent request — a 90-day sliding window.

Check who you are:

```bash
sl whoami
```

`sl whoami` prints the effective API URL and credential source, and exits non-zero when not logged in — handy as a CI auth check.

Log out (revokes the session server-side and clears the local file):

```bash
sl logout
```

**Headless / CI auth** (no magic-link prompt): pipe an API key into `--with-token`:

```bash
echo "$SL_API_KEY" | sl login --with-token
```

`--api-key <key>` and `--api-url <url>` are global flags available on every command, overriding `SL_API_KEY` / `SL_API_URL` for that one invocation.

## Create a project and bind a directory to it

A **project** owns billing and dedicated infrastructure. You bind a working directory to a project so every `sl` command in that directory targets the same backend.

```bash
sl projects create my-app
sl projects use my-app
sl projects get
```

`sl projects use` writes `./.secondlayer/project` in the current directory. That file takes precedence over the global default in `~/.secondlayer/config.json`. The CLI walks up parent directories looking for it, stopping at `.git`.

For an open-beta tenant you don't need an explicit instance step — the project comes with shared platform access.

## Environment variables

| Variable | Read by | Purpose |
|---|---|---|
| `SL_API_URL` | All SDK + CLI calls | Override platform API base. Default: `https://api.secondlayer.tools`. |
| `SL_API_KEY` | CLI (when bypassing session), MCP, SDK, `sl streams *`, `createStreamsClient` | API key for tenant/platform writes and Streams reads. CI / agent shortcut; prefer session-based `sl login` for humans. Issued from the dashboard. |
| `HIRO_API_KEY` | `sl contracts generate`, `sl subgraphs scaffold` | Stacks node API key for ABI fetches against Hiro RPC. |
| `SIGNING_SECRET` | `sl subscriptions test` fallback | If `--signing-secret` not passed. |
| `STACKS_NETWORK` | `sl contracts generate` and some local commands | `local`, `testnet`, or `mainnet`. |
| `SECONDLAYER_API_KEY` (in user code) | `new SecondLayer({ apiKey })` | What the SDK reads in your own code if you don't pass `apiKey` explicitly. (Naming is your choice; SDK takes the value via constructor.) |

## SDK quickstart

```typescript
import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer({
  apiKey: process.env.SECONDLAYER_API_KEY, // optional for read-only public endpoints
});

// Read tip of the chain (public)
const tip = await sl.streams.tip();

// List your subgraphs (requires apiKey)
const { data } = await sl.subgraphs.list();
```

Open-beta auth: **reads are anonymous** (`sl.streams.events.list`, `sl.index.ftTransfers.list`, `sl.subgraphs.queryTable`). **Writes need an apiKey** (`sl.subgraphs.deploy`, `sl.subscriptions.create`, `sl.subgraphs.delete`, `sl.subscriptions.rotateSecret`). Don't fabricate auth steps for read calls.

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
│   └── project              # Binds this dir to a project (created by `sl projects use`)
├── subgraphs/
│   ├── token-transfers.ts   # defineSubgraph(...) modules
│   └── contract-events.ts
├── src/
│   └── ...                  # Your app code, imports @secondlayer/sdk / @secondlayer/stacks
├── package.json             # Deps on @secondlayer/sdk, @secondlayer/subgraphs, @secondlayer/stacks
└── .env                     # SECONDLAYER_API_KEY, SL_API_KEY, SIGNING_SECRET, ...
```

Subgraph files live under `subgraphs/` by convention but the CLI accepts any path: `sl subgraphs deploy any/path/file.ts`.

## Upgrading

```bash
bun add -g @secondlayer/cli@latest
bun add @secondlayer/sdk@latest @secondlayer/subgraphs@latest @secondlayer/stacks@latest
```

Major versions occasionally change `defineSubgraph` payload shapes or extension method signatures. Always re-run `sl subgraphs spec <file>` after a `@secondlayer/subgraphs` major bump to confirm your handlers still type-check.
