# @secondlayer/sdk

TypeScript SDK for the Second Layer API.

## Install

```bash
bun add @secondlayer/sdk
```

## Quick Start

```typescript
import { SecondLayer } from "@secondlayer/sdk";

const sl = new SecondLayer({
  apiKey: "sk-sl_...",                          // or session token
  baseUrl: "https://api.secondlayer.tools",     // default
});
```

## Stacks Streams

Typed HTTP client.

`sk-sl_streams_status_public` is a public, non-secret Free-tier key used by the
Second Layer status page. Production apps should use their own Streams API key.

```typescript
import { createStreamsClient } from "@secondlayer/sdk";

const client = createStreamsClient({
  apiKey: process.env.SECONDLAYER_API_KEY!,
  baseUrl: process.env.SECONDLAYER_API_URL,
});

const tip = await client.tip();
const page = await client.events.list({
  types: ["ft_transfer"],
  limit: 10,
});

console.log({ tip, firstCursor: page.events[0]?.cursor });
```

Checkpointed consumer.

Use `client.events.consume` for indexers and ETL jobs. Write your database rows
inside `onBatch`, then return the cursor you committed. It exits when
`maxPages`, `maxEmptyPolls`, or `signal` stops it.

```typescript
import { createStreamsClient } from "@secondlayer/sdk";

const client = createStreamsClient({
  apiKey: process.env.SECONDLAYER_API_KEY!,
});

await client.events.consume({
  types: ["ft_transfer"],
  batchSize: 100,
  maxPages: 1,
  onBatch: async (events, envelope) => {
    for (const event of events) {
      console.log(event.cursor, event.tx_id);
    }
    return envelope.next_cursor;
  },
});
```

Live stream.

Use `client.events.stream` for live processors and watch-style apps. It follows
the tip indefinitely. Stop it with an `AbortSignal`.

```typescript
import { createStreamsClient } from "@secondlayer/sdk";

const client = createStreamsClient({
  apiKey: process.env.SECONDLAYER_API_KEY!,
});

const abort = new AbortController();
process.once("SIGINT", () => abort.abort());

for await (const event of client.events.stream({
  types: ["ft_transfer"],
  batchSize: 100,
  signal: abort.signal,
})) {
  console.log(event.cursor, event.tx_id);
}
```

Decoder helper.

```typescript
import {
  createStreamsClient,
  decodeFtTransfer,
  isFtTransfer,
} from "@secondlayer/sdk";

const client = createStreamsClient({
  apiKey: process.env.SECONDLAYER_API_KEY!,
});

for await (const event of client.events.stream({ types: ["ft_transfer"] })) {
  if (!isFtTransfer(event)) continue;
  const transfer = decodeFtTransfer(event);
  console.log(transfer.decoded_payload);
  break;
}
```

Helper convention: each event helper is a pure function with no shared state.
Use `is<EventName>(event)` as the type guard and `decode<EventName>(event)` as
the decoder. Decoders throw when the event type or payload is malformed. Add new
helpers beside `src/streams/ft-transfer.ts` and export them through
`src/streams/index.ts`.

## Subgraphs

Deploy and query subgraphs (custom indexers).

```typescript
// List
const { data } = await sl.subgraphs.list();

// Get
const subgraph = await sl.subgraphs.get("my-subgraph");

// Query table
const rows = await sl.subgraphs.queryTable("my-subgraph", "transfers", {
  sort: "block_height",
  order: "desc",
  limit: 50,
});

// Deploy
const result = await sl.subgraphs.deploy({ name, sources, schema, handlerCode });
```

## Subscriptions

Per-row HTTP webhooks from subgraph tables.

```typescript
// List / get
const { data } = await sl.subscriptions.list();
const sub = await sl.subscriptions.get(id);

// Create — sink a subgraph table to a signed webhook endpoint.
// `signingSecret` is returned ONCE; store it in the receiver's env.
const { subscription, signingSecret } = await sl.subscriptions.create({
  name: "whale-alerts",
  subgraphName: "transfers",
  tableName: "events",
  url: "https://example.com/hooks/transfers",
  format: "standard-webhooks", // or inngest | trigger | cloudflare | cloudevents | raw
});

// Lifecycle
await sl.subscriptions.update(id, { filter: { amount: { gte: "1000000" } } });
await sl.subscriptions.pause(id);
await sl.subscriptions.resume(id);
await sl.subscriptions.rotateSecret(id); // returns new signing secret once
const { data: deliveries } = await sl.subscriptions.recentDeliveries(id);

// Replay historical block range
await sl.subscriptions.replay(id, { fromBlock: 180000, toBlock: 181000 });

// Dead-letter inspection + requeue
const { data: dead } = await sl.subscriptions.dead(id);
await sl.subscriptions.requeueDead(id, outboxId);
```

## Error Handling

```typescript
import { ApiError } from "@secondlayer/sdk";

try {
  await sl.subgraphs.get("nonexistent");
} catch (err) {
  if (err instanceof ApiError) {
    console.log(err.status);  // 404
    console.log(err.message); // "Contract not found"
  }
}
```
