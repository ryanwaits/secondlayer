# Secondlayer

[![Status](https://img.shields.io/badge/status-public-111111)](https://secondlayer.tools/status)

The hosted indexer for Stacks. Curl decoded chain data keyless in ten seconds
(**Index**), deploy a one-file TypeScript indexer and get hosted Postgres
tables behind a public REST API (**Subgraphs**), or consume the raw signed
event firehose + parquet dumps to build your own (**Streams**) — no node, no
infra. Webhooks and an MCP server included. See [STRATEGY.md](STRATEGY.md).

```bash
curl "https://api.secondlayer.tools/v1/index/events?event_type=ft_transfer&limit=5"
```

- **Hosted** — managed platform, free during open beta. Reads are public; a key
  gates writes.
- **Self-host** — the whole stack is MIT-licensed. `docker compose up` runs
  indexer + API + processor on your own hardware.

## Quickstart (hosted)

```bash
bun add -g @secondlayer/cli

sl login
sl project create my-app && sl project use my-app

# Index a contract into a typed, queryable Postgres table
sl subgraphs scaffold SP1234ABCD.my-contract -o subgraphs/my-contract.ts
sl subgraphs deploy subgraphs/my-contract.ts --start-block <recent-block>
sl subgraphs query my-contract <table> --sort _block_height --order desc

# Push new rows to a webhook
sl subscriptions create my-hook --runtime node \
  --subgraph my-contract --table <table> --url https://<host>/webhook
```

Subscriptions are polymorphic. The above is a **subgraph** subscription (fires on
a subgraph table's rows). A **chain** subscription fires on raw chain events with
no subgraph — a turnkey webhook on a contract, event, function, or trait — and is
created via the SDK, REST, or MCP with a `triggers` array:

```typescript
import { SecondLayer, trigger } from "@secondlayer/sdk";

const sl = new SecondLayer({ apiKey: "sk-sl_..." });
const { subscription, signingSecret } = await sl.subscriptions.create({
  name: "amm-swaps",
  url: "https://my-app.com/webhook",
  triggers: [trigger.contractCall({ contractId: "SP....amm", functionName: "swap-*" })],
});
```

Full walkthrough → [QUICKSTART](packages/subgraphs/QUICKSTART.md) ·
commands → [CLI reference](packages/cli/README.md).

## Read it from anywhere

Reads are public for **public** subgraphs (managed deploys default public; private
ones need the owner's `sk-sl_` key); the SDK defaults to `https://api.secondlayer.tools`.

```typescript
import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer();
const { rows, next_cursor, tip } = await sl.subgraphs.rows("my-contract", "<table>", {
  order: "desc",
  limit: 25,
});
```

```bash
curl "https://api.secondlayer.tools/v1/subgraphs/my-contract/<table>?_limit=25"
```

Pages are `_id`-keyset: pass `?cursor=<next_cursor>` to resume, `_order=asc|desc`
for direction.

**MCP** — point any MCP client at `bunx -p @secondlayer/mcp secondlayer-mcp`
(`SECONDLAYER_API_URL=https://api.secondlayer.tools`). Set `SL_API_KEY` to
enable writes (deploy/manage). See [MCP README](packages/mcp/README.md).

## Packages

Two TypeScript SDKs, one chooser: **`@secondlayer/sdk`** talks to the platform
(query subgraphs, manage webhooks/keys); **`@secondlayer/stacks`** is low-level
chain primitives (Clarity decoding, reads). Most apps only need `sdk`.

| Package | Description |
|---|---|
| [`@secondlayer/cli`](packages/cli/README.md) | `sl` binary — auth, projects, subgraph deploy, Clarity code-gen |
| [`@secondlayer/sdk`](packages/sdk/README.md) | TypeScript SDK — typed subgraph queries, webhooks |
| [`@secondlayer/mcp`](packages/mcp/README.md) | MCP server — subgraphs + scaffolding for AI agents |
| [`@secondlayer/stacks`](packages/stacks/README.md) | viem-style Stacks client — public/wallet, BNS, AI-SDK tools |
| [`@secondlayer/subgraphs`](packages/subgraphs/README.md) | `defineSubgraph()` — declarative schema, triggers + handlers |
| [`@secondlayer/shared`](packages/shared/README.md) | Shared db, schemas, crypto helpers |
| [`@secondlayer/api`](packages/api/README.md) | REST API — hosted + self-host modes |

## Self-host

```bash
git clone https://github.com/ryanwaits/secondlayer
cd secondlayer
cp docker/.env.example docker/.env   # fill in secrets
docker compose -f docker/docker-compose.yml up -d
```

[OSS quickstart](docker/oss/README.md) · operations & backups in [docker/docs/](docker/docs/).

## Development

```bash
bun install && bun run build && bun run test
```

Releases flow through [Changesets](https://github.com/changesets/changesets):
`bun run version` to bump, `bun run release` to publish.

## License

MIT
