# Secondlayer

Agent-native developer tools for Stacks. Dedicated indexing + real-time
subgraphs + packaged protocol monitoring — all exposed through one API, one
auth model, and three interchangeable front-ends (CLI, SDK, MCP).

Two ways to run it:

- **Hosted** — dedicated per-project Postgres + API + subgraph processor.
  Hobby is free (auto-pauses after 7d idle); paid tiers start at $149/mo.
  Pricing: [secondlayer.tools/pricing](https://secondlayer.tools/pricing).
- **Self-host** — the whole stack is MIT-licensed. `docker compose up` gets
  you indexer + API + processor on your own hardware. See
  [`docker/oss/README.md`](docker/oss/README.md).

## What's shipped

- **Subgraphs** — `defineSubgraph()` declares event filters + column schema;
  the processor indexes the chain into a typed Postgres view you query over
  REST.
- **Sentries** — packaged monitoring for protocols (whale transfers, admin
  role changes, contract deployments, custom print events). AI-triaged
  alerts delivered to a Slack-compatible webhook.
- **Workflows SDK** — `defineWorkflow()` with three durable step primitives
  (`step.run`, `step.sleep`, `step.invoke`) for writing your own automation.

## Quickstart (hosted)

```bash
bun add -g @secondlayer/cli

sl login                            # magic-link email
sl project create my-app
sl project use my-app
sl instance create --plan hobby     # free tier; upgrade anytime
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
