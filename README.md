# Secondlayer

Agent-native developer tools for Stacks. Dedicated indexing + real-time
subgraphs + a viem-style chain SDK — exposed through one API, one auth model,
and three interchangeable front-ends (CLI, SDK, MCP).

Two ways to run it:

- **Hosted** — dedicated per-project Postgres + API + subgraph processor.
  Hobby is free (auto-pauses after 7d idle); paid tiers start at $149/mo.
- **Self-host** — the whole stack is MIT-licensed. `docker compose up` gets
  you indexer + API + processor on your own hardware. See
  [`docker/oss/README.md`](docker/oss/README.md).

## What's shipped

- **Subgraphs** — `defineSubgraph()` declares event filters + column schema;
  the processor indexes the chain into a typed Postgres view you query over
  REST.
- **Subscriptions** — per-row HTTP webhooks from subgraph tables. Signed
  Standard Webhooks POSTs, 7× retries with backoff, circuit-breaks at 20
  consecutive failures, 6 wire formats (`standard-webhooks`, `inngest`,
  `trigger`, `cloudflare`, `cloudevents`, `raw`), historical replay by
  block range.
- **`@secondlayer/stacks`** — viem-style chain SDK: typed contract calls,
  wallets, BNS, transaction builders, and AI-SDK `tool({...})` values.

## Beta Quickstart (Hosted)

This path gets a new beta user from zero to a live indexed table and webhook
receiver. The CLI resolves your active project and mints short-lived tenant
credentials for each command, so you do not need to copy service keys unless
you are using the SDK, MCP, or raw REST.

```bash
bun add -g @secondlayer/cli

sl login
sl project create my-app
sl project use my-app
sl instance create --plan hobby

sl subgraphs scaffold SP1234ABCD.my-contract -o subgraphs/my-contract.ts
sl subgraphs deploy subgraphs/my-contract.ts --start-block <recent-block>
sl subgraphs query my-contract <table> --sort _block_height --order desc

sl create subscription my-hook \
  --runtime node \
  --subgraph my-contract \
  --table <table> \
  --url https://<receiver-host>/webhook
```

`sl subgraphs scaffold` writes `subgraphs/my-contract.ts`, creates or updates
the local `package.json`, and runs `bun install` by default. Use
`--no-install` only when you want to run `bun install` yourself before deploy.

Use `--start-block` for fast demos; it overrides the definition for that deploy
without rewriting your source file. For Trigger.dev or Cloudflare receivers,
add `--auth-token <token>` when creating or updating the subscription.

Full walkthrough: [packages/subgraphs/QUICKSTART.md](packages/subgraphs/QUICKSTART.md).
Full command reference: [packages/cli/README.md](packages/cli/README.md).

## Agent-native golden path

1. Give an agent the contract address and the events or calls you care about.
2. The agent scaffolds a `defineSubgraph()` from the contract ABI, validates it,
   and deploys it to your dedicated instance.
3. Query the generated table over REST, SDK, CLI, or MCP.
4. Add a subscription on that table when the rows should trigger another system.
5. Replay by block range when a receiver changes or misses deliveries.

Reviewable walkthrough: [packages/subgraphs/QUICKSTART.md](packages/subgraphs/QUICKSTART.md).

## Packages

| Package | Description |
|---|---|
| [`@secondlayer/cli`](packages/cli/README.md) | `sl` binary — auth, project/instance lifecycle, subgraph deploy, Clarity code-gen |
| [`@secondlayer/sdk`](packages/sdk/README.md) | TypeScript SDK — typed subgraph queries, webhooks |
| [`@secondlayer/mcp`](packages/mcp/README.md) | MCP server — exposes subgraphs + scaffolding to AI agents |
| [`@secondlayer/stacks`](packages/stacks/README.md) | viem-style Stacks client — public/wallet, BNS, AI-SDK tools |
| [`@secondlayer/subgraphs`](packages/subgraphs/README.md) | `defineSubgraph()` — declarative schema, triggers + event handlers |
| [`@secondlayer/shared`](packages/shared/README.md) | Shared db, schemas, crypto helpers |
| [`@secondlayer/api`](packages/api/README.md) | REST API — platform + dedicated + OSS modes |

## Surfaces

### CLI

```bash
sl login
sl project use my-app
sl subgraphs deploy ./my-subgraph.ts --start-block <recent-block>
sl subgraphs query my-subgraph transfers --sort _block_height --order desc
sl create subscription transfer-hook --runtime node --subgraph my-subgraph --table transfers --url https://example.com/webhook
```

### SDK

```typescript
import { SecondLayer } from "@secondlayer/sdk"

const sl = new SecondLayer({
  baseUrl: "https://<slug>.secondlayer.tools",
  apiKey: process.env.SL_SERVICE_KEY,
})

const { data } = await sl.subgraphs.queryTable("transfers", "events", {
  filters: { sender: "SP1234..." },
  sort: "_block_height",
  order: "desc",
  limit: 25,
})
```

### REST API

```bash
curl -H "Authorization: Bearer $SL_SERVICE_KEY" \
  "https://<slug>.secondlayer.tools/api/subgraphs/transfers/events?_sort=_block_height&_order=desc&_limit=25"
```

### MCP (AI agents)

Point Claude Desktop, Cursor, or any MCP client at `bunx -p @secondlayer/mcp secondlayer-mcp`
with `SECONDLAYER_API_URL=https://<slug>.secondlayer.tools` and
`SL_SERVICE_KEY` set. See [packages/mcp/README.md](packages/mcp/README.md).

## Self-hosting

```bash
git clone https://github.com/ryanwaits/secondlayer
cd secondlayer
cp docker/.env.example docker/.env   # fill in secrets
docker compose -f docker/docker-compose.yml up -d
```

See [docker/oss/README.md](docker/oss/README.md) for the OSS-mode quickstart
and [docker/docs/](docker/docs/) for operations, backups, and dedicated
hosting internals.

## Development

```bash
bun install
bun run build
bun run typecheck
bun run test
```

Releases flow through [Changesets](https://github.com/changesets/changesets) —
`bun run version` to bump, `bun run release` to publish.

## License

MIT
