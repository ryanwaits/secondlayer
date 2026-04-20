# Secondlayer

Dedicated Stacks indexing and real-time subgraphs. Turn onchain events into
typed, queryable views of the chain — pick the events your app needs, shape
them into tables, query over HTTP or GraphQL.

- **Dedicated hosting** — each project gets a managed Postgres + API +
  subgraph processor. No shared schema, no `api_key_id` filtering, no
  noisy-neighbor surprises.
- **Open source** — self-host the whole stack with `docker compose up`, or
  use the hosted platform at `https://api.secondlayer.tools`.
- **One surface, three front-ends** — CLI, SDK, and MCP server all hit the
  same API and share the same auth model.

## Quickstart

```bash
bun add -g @secondlayer/cli

sl login                            # magic-link email
sl project create my-app
sl project use my-app
sl instance create --plan launch    # provisions a dedicated tenant
sl subgraphs deploy ./my-subgraph.ts
```

Full command reference: [packages/cli/README.md](packages/cli/README.md).

## Packages

| Package | Description |
|---|---|
| [`@secondlayer/cli`](packages/cli/README.md) | `sl` binary — auth, project/instance lifecycle, subgraph deploy, Clarity code-gen |
| [`@secondlayer/sdk`](packages/sdk/README.md) | TypeScript SDK — typed subgraph queries, workflow triggers, webhooks |
| [`@secondlayer/mcp`](packages/mcp/README.md) | MCP server — exposes subgraphs, workflows, scaffolding to AI agents |
| [`@secondlayer/stacks`](packages/stacks/README.md) | viem-style Stacks client — public/wallet, BNS, triggers, AI-SDK tools |
| [`@secondlayer/subgraphs`](packages/subgraphs/README.md) | `defineSubgraph()` — declarative schema + event handlers |
| [`@secondlayer/workflows`](packages/workflows/README.md) | `defineWorkflow()` — durable onchain automation |
| [`@secondlayer/shared`](packages/shared/README.md) | Shared db, schemas, auth primitives |
| [`@secondlayer/api`](packages/api/README.md) | REST API — platform + dedicated + OSS modes |

## Surfaces

### CLI

```bash
sl login
sl project use my-app
sl subgraphs deploy ./my-subgraph.ts
sl subgraphs query my-subgraph transfers --sort _block_height --order desc
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

Point Claude Desktop, Cursor, or any MCP client at `npx @secondlayer/mcp`
with `SL_SERVICE_KEY` set. See [packages/mcp/README.md](packages/mcp/README.md).

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
