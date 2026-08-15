# Beta Quickstart: Subgraphs + Subscriptions

The shortest complete loop for a hosted beta user:

1. Log in and pick a project.
2. Deploy a subgraph from a recent block so rows appear quickly.
3. Query the generated table.
4. Add a receiver subscription.
5. Inspect deliveries and replay a block range when needed.

## Mental Model

A **subgraph** is a TypeScript definition with three parts:

- `sources` name the chain events or calls to match.
- `schema` declares the Postgres tables Secondlayer maintains.
- `handlers` turn matched chain activity into rows with `ctx.insert()`,
  `ctx.upsert()`, `ctx.patch()`, and related helpers.

A **subscription** is a signed webhook delivery rule. It comes in two kinds:

- **subgraph** — watches one subgraph table (`subgraphName + tableName`),
  optionally filters rows, and enqueues delivery in the same transaction as the
  subgraph row. This quickstart uses this kind.
- **chain** — fires on raw chain events with no subgraph (pass a `triggers`
  array instead of a subgraph/table). Forward-looking — starts at the chain tip,
  never backfills. Create with `secondlayer subscriptions create … --trigger`, or the
  same `triggers` array on the SDK / REST. See the
  [SDK README](../sdk/README.md#chain-subscriptions).

Both POST to your receiver with retries, circuit breaking, delivery logs,
dead-letter requeue, and (subgraph) historical replay.

## 1. Log In And Pick A Project

```bash
bun add -g @secondlayer/cli

secondlayer login
secondlayer project create my-app
secondlayer project use my-app
secondlayer whoami
```

`secondlayer login` authenticates an interactive session; the CLI uses that session and
your active project for all `secondlayer subgraphs` and `secondlayer subscriptions` commands.

For machine, REST, or SDK access, create an API key (prefixed `sk-sl_`) in the
platform console at https://secondlayer.tools/platform/api-keys, then export it:

```bash
export SECONDLAYER_API_URL="https://api.secondlayer.tools"
export SL_API_URL="$SECONDLAYER_API_URL"
export SL_API_KEY="sk-sl_..."
```

Deploys default **public** — anon-readable on `/v1/subgraphs`, no key.
Writes (deploy, manage, subscriptions) require an
`sk-sl_` key. (`SECONDLAYER_API_KEY` is a deprecated alias of `SL_API_KEY`.)
Rotate or revoke keys in the same console.

## 2. Create A Subgraph

Scaffold from a contract ABI when you have a specific contract:

```bash
secondlayer subgraphs scaffold SP1234ABCD.my-contract -o subgraphs/my-contract.ts
```

The scaffolder creates or updates the module `package.json` in the output
directory and runs `bun install` by default. With `--no-install`, run
`bun install` in that directory before deploying.

Or create `subgraphs/stx-transfers.ts` manually:

```ts
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "stx-transfers",
  version: "1.0.0",
  startBlock: 0,

  sources: {
    transfer: { type: "stx_transfer" },
  },

  schema: {
    transfers: {
      columns: {
        sender: { type: "principal", indexed: true },
        recipient: { type: "principal", indexed: true },
        amount: { type: "uint" },
      },
    },
  },

  handlers: {
    transfer(event, ctx) {
      ctx.insert("transfers", {
        sender: event.sender,
        recipient: event.recipient,
        amount: event.amount,
      });
    },
  },
});
```

For beta demos, deploy from a recent block so catch-up is fast. The override is
deploy-time only; it does not rewrite the source file. Omit `--start-block` to
use the file's `startBlock` as the source of truth.

```bash
secondlayer subgraphs deploy subgraphs/stx-transfers.ts --start-block <recent-block>
secondlayer subgraphs status stx-transfers
```

## 3. Query Rows

```bash
secondlayer subgraphs query stx-transfers transfers \
  --sort _block_height \
  --order desc \
  --limit 10
```

Add filters as rows arrive:

```bash
secondlayer subgraphs query stx-transfers transfers \
  --filter sender=SP... \
  --filter amount.gte=1000000 \
  --sort _block_height \
  --order desc
```

With REST (anon — public subgraph):

```bash
curl "$SECONDLAYER_API_URL/v1/subgraphs/stx-transfers/transfers?_order=desc&_limit=10"
```

Rows are `_id`-keyset ordered — pass `?cursor=<next_cursor>` to resume
(`_sort`/`_offset` not supported on /v1).

## 4. Add A Receiver

For local testing, expose your receiver with a public HTTPS tunnel and use that
URL in the subscription. Production receivers can run anywhere that accepts
HTTPS POSTs.

Standard Webhooks receiver:

```bash
secondlayer subscriptions create transfer-hook \
  --runtime node \
  --subgraph stx-transfers \
  --table transfers \
  --url https://<receiver-host>/webhook \
  --filter amount.gte=1000000

cd transfer-hook
bun install
bun run dev
```

The generated Node receiver verifies Standard Webhooks signatures. The signing
secret is shown once by the API and written into the generated `.env`.

Trigger.dev receiver:

```bash
secondlayer subscriptions create transfer-trigger \
  --runtime trigger \
  --subgraph stx-transfers \
  --table transfers \
  --url https://api.trigger.dev/api/v1/tasks/<task-id>/trigger \
  --auth-token tr_secret_...
```

Cloudflare Workflows receiver:

```bash
secondlayer subscriptions create transfer-workflow \
  --runtime cloudflare \
  --subgraph stx-transfers \
  --table transfers \
  --url https://api.cloudflare.com/client/v4/accounts/<account-id>/workflows/<workflow>/instances \
  --auth-token <cloudflare-api-token>
```

Patch an existing receiver without touching JSON:

```bash
secondlayer subscriptions update transfer-trigger --auth-token tr_secret_next
secondlayer subscriptions update transfer-hook --url https://<new-host>/webhook
```

## 5. Inspect Deliveries

```bash
secondlayer subscriptions list
secondlayer subscriptions get transfer-hook
secondlayer subscriptions deliveries transfer-hook
secondlayer subscriptions doctor transfer-hook
```

Generate a signed test request for a Standard Webhooks receiver:

```bash
secondlayer subscriptions test transfer-hook --signing-secret "$SIGNING_SECRET"
secondlayer subscriptions test transfer-hook --signing-secret "$SIGNING_SECRET" --post
```

Replay a historical range after a receiver changes or misses events. Replay
scans existing subgraph rows in the range and enqueues replay deliveries:

```bash
secondlayer subscriptions replay transfer-hook \
  --from-block 123000 \
  --to-block 124000
```

Operational commands accept either subscription id or unique name and support
`--json`.

## SDK And MCP Setup

Use the SDK when setup needs to live in application code. Pass your `sk-sl_` key
via the `apiKey` option:

```ts
import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer({
  baseUrl: process.env.SECONDLAYER_API_URL!,
  apiKey: process.env.SL_API_KEY!, // sk-sl_...
});

const { data } = await sl.subgraphs.queryTable("stx-transfers", "transfers", {
  sort: "_block_height",
  order: "desc",
  limit: 10,
});

const { subscription, signingSecret } = await sl.subscriptions.create({
  name: "large-stx-transfers",
  subgraphName: "stx-transfers",
  tableName: "transfers",
  url: "https://example.com/webhook",
  format: "standard-webhooks",
  runtime: "node",
  filter: { amount: { gte: "1000000" } },
});

console.log(data.length, subscription.id, signingSecret);
```

Use MCP when an agent should scaffold, deploy, query, and subscribe:

```json
{
  "mcpServers": {
    "secondlayer": {
      "command": "bunx",
      "args": ["-p", "@secondlayer/mcp", "secondlayer-mcp"],
      "env": {
        "SECONDLAYER_API_URL": "https://api.secondlayer.tools",
        "SL_API_KEY": "sk-sl_..."
      }
    }
  }
}
```

The `subgraphs_deploy` tool also accepts `startBlock` for fast beta demos.

## Filter Syntax

CLI filters:

```bash
--filter sender=SP...
--filter amount.gte=1000000
--filter amount.lt=5000000
```

Supported CLI suffixes: `.eq`, `.neq`, `.gt`, `.gte`, `.lt`, `.lte`. Bare
`key=value` is equality. Multiple fields are ANDed together. CLI create and
update filters are schema-aware, and the API repeats table, field, and operator
validation as the source of truth.
</content>
</invoke>
