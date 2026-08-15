# Secondlayer

Your app needs Stacks data that no public API has — your contract, your
schema, your uptime. Today that means writing an indexer.

Secondlayer is the runtime instead: decoded chain data in your own database,
backfilled from genesis, reorg-safe, kept current. Get tables and a REST API
out of the box, or stream rows into your own schema — Postgres, SQLite, or
anything you already run — and serve them however you already serve things.

The instance itself is Postgres plus one container, on your hardware.

See [STRATEGY.md](STRATEGY.md).

```bash
curl "http://127.0.0.1:3800/v1/index/events?event_type=ft_transfer&limit=5"
```

## Quickstart

```bash
bun add -g @secondlayer/cli
secondlayer init --network mainnet
cd docker/oss && docker compose up -d
secondlayer observer --mode indexer --endpoint secondlayer:3700
secondlayer bootstrap --against <manifest>
secondlayer verify all --against <manifest>

# Index a contract into a typed, queryable Postgres table
export SL_API_URL=http://127.0.0.1:3800
secondlayer subgraphs scaffold SP1234ABCD.my-contract -o subgraphs/my-contract.ts
secondlayer subgraphs deploy subgraphs/my-contract.ts --start-block <recent-block>
secondlayer subgraphs query my-contract <table> --sort _block_height --order desc
```

A **chain** subscription fires on raw events with no subgraph:

```bash
secondlayer subscriptions create amm-swaps \
  --url https://my-app.com/webhook \
  --trigger '{"type":"contract_call","contractId":"SP....amm","functionName":"swap-*"}'
```

Docs → [self-host](https://www.secondlayer.tools/docs/self-host) ·
CLI → [packages/cli/README.md](packages/cli/README.md).

## Read it from your instance

SDK default is `http://127.0.0.1:3800` (or `SL_API_URL`).

```typescript
import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer();
const { rows, next_cursor, tip } = await sl.subgraphs.rows("my-contract", "<table>", {
  order: "desc",
  limit: 25,
});
```

```bash
curl "http://127.0.0.1:3800/v1/subgraphs/my-contract/<table>?_limit=25"
```

Pages are `_id`-keyset: pass `?cursor=<next_cursor>` to resume, `_order=asc|desc`
for direction.

**MCP** — `bunx -p @secondlayer/mcp secondlayer-mcp` (default local API).
Set `SL_API_KEY` to the `INSTANCE_TOKEN` from `secondlayer init` for writes.
enable writes (deploy/manage). See [MCP README](packages/mcp/README.md).

## Packages

Two TypeScript SDKs, one chooser: **`@secondlayer/sdk`** talks to this instance
(query subgraphs, manage webhooks); **`@secondlayer/stacks`** is low-level
chain primitives (Clarity decoding, reads). Most apps only need `sdk`.

| Package | Description |
|---|---|
| [`@secondlayer/cli`](packages/cli/README.md) | `secondlayer` binary — init, bootstrap, verify, deploy |
| [`@secondlayer/sdk`](packages/sdk/README.md) | TypeScript SDK — Streams, Index, subgraphs, webhooks |
| [`@secondlayer/mcp`](packages/mcp/README.md) | MCP server — instance tools for agents |
| [`@secondlayer/stacks`](packages/stacks/README.md) | viem-style Stacks client — public/wallet, BNS |
| [`@secondlayer/subgraphs`](packages/subgraphs/README.md) | `defineSubgraph()` — schema, triggers, handlers |
| [`@secondlayer/shared`](packages/shared/README.md) | Shared db, schemas, crypto helpers |
| [`@secondlayer/api`](packages/api/README.md) | REST API for the instance |

## Self-host

```bash
git clone https://github.com/ryanwaits/secondlayer
cd secondlayer/docker/oss
secondlayer init --network mainnet
docker compose up -d
```

[OSS quickstart](docker/oss/README.md).

## Development

```bash
bun install && bun run build && bun run test
```

Releases flow through [Changesets](https://github.com/changesets/changesets):
`bun run version` to bump, `bun run release` to publish.

## License

MIT
