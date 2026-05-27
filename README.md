# Secondlayer

[![Status](https://img.shields.io/badge/status-public-111111)](https://secondlayer.tools/status)

The agent-native data plane for Stacks. Dedicated indexing, real-time subgraphs,
and a viem-style chain SDK behind one API — usable from the CLI, SDK, or MCP.
Indexed once, free to read.

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
sl create subscription my-hook --runtime node \
  --subgraph my-contract --table <table> --url https://<host>/webhook
```

Full walkthrough → [QUICKSTART](packages/subgraphs/QUICKSTART.md) ·
commands → [CLI reference](packages/cli/README.md).

## Read it from anywhere

Reads are public — no key needed; the SDK defaults to `https://api.secondlayer.tools`.

```typescript
import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer();
const { data } = await sl.subgraphs.queryTable("my-contract", "<table>", {
  sort: "_block_height",
  order: "desc",
  limit: 25,
});
```

```bash
curl "https://api.secondlayer.tools/api/subgraphs/my-contract/<table>?_limit=25"
```

**MCP** — point any MCP client at `bunx -p @secondlayer/mcp secondlayer-mcp`
(`SECONDLAYER_API_URL=https://api.secondlayer.tools`). Set `SL_SERVICE_KEY` to
enable writes (deploy/manage). See [MCP README](packages/mcp/README.md).

## Packages

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
