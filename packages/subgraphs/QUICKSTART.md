# Beta Quickstart: Subgraphs + Subscriptions

This guide is the shortest complete onboarding loop for a hosted beta user:

1. Create a project and dedicated tenant.
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

A **subscription** is a delivery rule on one subgraph table:

- It watches `subgraphName + tableName`.
- It can filter rows with scalar conditions.
- It enqueues delivery work in the same transaction as the subgraph row.
- It POSTs to your receiver with retries, circuit breaking, delivery logs,
  dead-letter requeue, and historical replay.

## 1. Create A Tenant

```bash
bun add -g @secondlayer/cli

sl login
sl project create my-app
sl project use my-app
sl instance create --plan launch
sl whoami
```

The CLI uses your login session and active project to mint short-lived tenant
credentials for `sl subgraphs` and `sl subscriptions` commands. Save the
instance URL and service key printed by `sl instance create` only when you want
SDK, MCP, or raw REST access:

```bash
export SECONDLAYER_API_URL="https://<slug>.secondlayer.tools"
export SL_API_URL="$SECONDLAYER_API_URL"
export SL_SERVICE_KEY="sl_live_..."
```

If you lose the service key:

```bash
sl instance keys rotate --service
```

## 2. Create A Subgraph

Scaffold from a contract ABI when you have a specific contract:

```bash
sl subgraphs scaffold SP1234ABCD.my-contract -o subgraphs/my-contract.ts
```

The scaffolder also creates or updates the module `package.json` in the output
directory and runs `bun install` by default. If you pass `--no-install`, run
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
deploy-time only; it does not rewrite the source file.

```bash
sl subgraphs deploy subgraphs/stx-transfers.ts --start-block <recent-block>
sl subgraphs status stx-transfers
```

Use the file's `startBlock` when you want the definition to be the source of
truth:

```bash
sl subgraphs deploy subgraphs/stx-transfers.ts
```

## 3. Query Rows

```bash
sl subgraphs query stx-transfers transfers \
  --sort _block_height \
  --order desc \
  --limit 10
```

Add filters as rows arrive:

```bash
sl subgraphs query stx-transfers transfers \
  --filter sender=SP... \
  --filter amount.gte=1000000 \
  --sort _block_height \
  --order desc
```

With REST:

```bash
curl -H "Authorization: Bearer $SL_SERVICE_KEY" \
  "$SECONDLAYER_API_URL/api/subgraphs/stx-transfers/transfers?_sort=_block_height&_order=desc&_limit=10"
```

## 4. Add A Receiver

For local testing, expose your receiver with a public HTTPS tunnel and use that
URL in the subscription. Production receivers can run anywhere that accepts
HTTPS POSTs.

Standard Webhooks receiver:

```bash
sl create subscription transfer-hook \
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
sl create subscription transfer-trigger \
  --runtime trigger \
  --subgraph stx-transfers \
  --table transfers \
  --url https://api.trigger.dev/api/v1/tasks/<task-id>/trigger \
  --auth-token tr_secret_...
```

Cloudflare Workflows receiver:

```bash
sl create subscription transfer-workflow \
  --runtime cloudflare \
  --subgraph stx-transfers \
  --table transfers \
  --url https://api.cloudflare.com/client/v4/accounts/<account-id>/workflows/<workflow>/instances \
  --auth-token <cloudflare-api-token>
```

Patch an existing receiver without touching JSON:

```bash
sl subscriptions update transfer-trigger --auth-token tr_secret_next
sl subscriptions update transfer-hook --url https://<new-host>/webhook
```

## 5. Inspect Deliveries

```bash
sl subscriptions list
sl subscriptions get transfer-hook
sl subscriptions deliveries transfer-hook
sl subscriptions doctor transfer-hook
```

Generate a signed test request for a Standard Webhooks receiver:

```bash
sl subscriptions test transfer-hook --signing-secret "$SIGNING_SECRET"
sl subscriptions test transfer-hook --signing-secret "$SIGNING_SECRET" --post
```

Replay a historical range after a receiver changes or misses events:

```bash
sl subscriptions replay transfer-hook \
  --from-block 123000 \
  --to-block 124000
```

Replay scans existing subgraph rows in the range and enqueues replay
deliveries. Operational commands accept either subscription id or unique name
and support `--json`.

## SDK And MCP Setup

Use the SDK when setup needs to live in application code:

```ts
import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer({
  baseUrl: process.env.SECONDLAYER_API_URL!,
  apiKey: process.env.SL_SERVICE_KEY!,
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
        "SECONDLAYER_API_URL": "https://<slug>.secondlayer.tools",
        "SL_SERVICE_KEY": "sl_live_..."
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
update filters are schema-aware, and the API repeats table, field, and
operator validation as the source of truth.
