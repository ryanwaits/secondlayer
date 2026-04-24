# Subgraphs + Subscriptions Quickstart

This is the shortest path to prove the new product loop:

1. Create a dedicated instance.
2. Deploy a subgraph that writes rows into a typed table.
3. Query that table.
4. Attach a subscription that delivers each matching row to a receiver.
5. Replay a block range when a receiver changes or misses events.

## Mental model

A **subgraph** is a small indexer definition:

- `sources` decide which chain events or calls match.
- `schema` declares the Postgres tables Secondlayer should maintain.
- `handlers` convert matched chain activity into rows with `ctx.insert()`, `ctx.upsert()`, etc.

A **subscription** is a row-level delivery rule on a subgraph table:

- It watches one `subgraphName + tableName`.
- It can optionally filter rows with scalar conditions.
- It writes delivery work into `subscription_outbox` in the same transaction as the subgraph row.
- The emitter signs and POSTs the event, retries failures, circuit-breaks bad receivers, and can replay old block ranges.

## 1. Create a project and instance

```bash
bun add -g @secondlayer/cli

sl login
sl project create my-app
sl project use my-app
sl instance create --plan hobby
sl whoami
```

CLI commands use your logged-in session and active project to mint short-lived tenant credentials. Save the instance URL and service key shown by `sl instance create` only if you want to use SDK or raw REST calls:

```bash
export SL_API_URL="https://<your-instance>.secondlayer.tools"
export SL_SERVICE_KEY="sl_live_..."
```

If you lost the service key, rotate it:

```bash
sl instance keys rotate --service
```

## 2. Write a subgraph

Create `subgraphs/stx-transfers.ts`:

```ts
import { defineSubgraph } from "@secondlayer/subgraphs";

export default defineSubgraph({
  name: "stx-transfers",
  version: "1.0.0",
  // Use a recent block for a fast first run; use 0 only if you want full history.
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

Deploy it:

```bash
sl subgraphs deploy subgraphs/stx-transfers.ts
sl subgraphs status stx-transfers
```

## 3. Query rows

```bash
sl subgraphs query stx-transfers transfers \
  --sort _block_height \
  --order desc \
  --limit 10
```

With filters:

```bash
sl subgraphs query stx-transfers transfers \
  --filter sender=SP... \
  --filter amount.gte=1000000 \
  --sort _block_height \
  --order desc
```

Over HTTP:

```bash
curl -H "Authorization: Bearer $SL_SERVICE_KEY" \
  "$SL_API_URL/api/subgraphs/stx-transfers/transfers?_sort=_block_height&_order=desc&_limit=10"
```

## 4. Create a subscription receiver

For local testing, expose port `3000` with a public tunnel and use the public HTTPS URL as the subscription URL. Production receivers can run anywhere that accepts HTTPS POSTs.

```bash
sl create subscription transfer-hook \
  --runtime node \
  --subgraph stx-transfers \
  --table transfers \
  --url https://<your-public-host>/webhook \
  --filter amount.gte=1000000
```

Omit `--filter` to receive every new row. The command scaffolds a receiver into `./transfer-hook`, provisions the subscription through your active project, and writes the one-time signing secret into the receiver `.env`.

Run the receiver:

```bash
cd transfer-hook
bun install
bun run dev
```

Each delivery is a signed Standard Webhooks event:

```json
{
  "type": "stx-transfers.transfers.created",
  "timestamp": "2026-04-24T00:00:00.000Z",
  "data": {
    "sender": "SP...",
    "recipient": "SP...",
    "amount": "1000000",
    "_block_height": 123456,
    "_tx_id": "0x..."
  }
}
```

## 5. Filter syntax and SDK setup

CLI filters use the same `key=value` shape as subgraph queries:

```bash
--filter sender=SP...
--filter amount.gte=1000000
--filter amount.lt=5000000
```

Supported CLI suffixes: `.eq`, `.neq`, `.gt`, `.gte`, `.lt`, `.lte`. Bare `key=value` is equality. Multiple fields are ANDed together.

Use the SDK when you want programmatic setup or richer JSON filters:

```ts
import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer({
  baseUrl: process.env.SL_API_URL!,
  apiKey: process.env.SL_SERVICE_KEY!,
});

const { subscription, signingSecret } = await sl.subscriptions.create({
  name: "large-stx-transfers",
  subgraphName: "stx-transfers",
  tableName: "transfers",
  url: "https://example.com/webhook",
  format: "standard-webhooks",
  runtime: "node",
  filter: {
    amount: { gte: "1000000" },
  },
});

console.log(subscription.id);
console.log(signingSecret); // Store once; rotate if lost.
```

Filter DSL:

- `{ sender: "SP..." }` means equality.
- `{ amount: { gte: "1000000" } }` supports `eq`, `neq`, `gt`, `gte`, `lt`, `lte`.
- `{ sender: { in: ["SP...", "SP..."] } }` matches any listed scalar through SDK/REST.
- Multiple fields are ANDed together.

## 6. Inspect deliveries and replay history

List subscriptions:

```bash
curl -H "Authorization: Bearer $SL_SERVICE_KEY" \
  "$SL_API_URL/api/subscriptions"
```

Inspect recent delivery attempts:

```bash
curl -H "Authorization: Bearer $SL_SERVICE_KEY" \
  "$SL_API_URL/api/subscriptions/$SUBSCRIPTION_ID/deliveries"
```

Replay a block range:

```bash
curl -X POST \
  -H "Authorization: Bearer $SL_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"fromBlock":123000,"toBlock":124000}' \
  "$SL_API_URL/api/subscriptions/$SUBSCRIPTION_ID/replay"
```

Replay scans existing subgraph rows in that range and enqueues them as replay deliveries. Re-running the same range is idempotent unless the API caller passes a force suffix.

## Product gaps to review

- `sl create subscription` now provisions through the same active-project path as `sl subgraphs ...`, but the CLI still only covers create. List/update/replay currently require SDK, REST, MCP, or dashboard support.
- CLI filters support equality/comparison operators, but not the SDK/REST-only `in` operator.
- The dashboard is useful for inspection, but the strongest golden path is still CLI/MCP/SDK first: scaffold, deploy, query, subscribe, replay.
