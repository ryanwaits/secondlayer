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
  apiKey: "sk-sl_...",                          // or `sl login` session token
  baseUrl: "https://api.secondlayer.tools",     // default
});
```

`sl.index` and `sl.subgraphs` reads are anonymous — no key needed. **`sl.streams`
reads require a bearer token** (`apiKey`) and resolve a per-tier tenant; a
publicly-known free-tier token exists but a bearer is always required. Writes
require an `sk-sl_` API key, created in the platform console at
https://secondlayer.tools/platform/api-keys. (Public Streams bulk dumps —
`client.dumps`, `events.replay` — need no key.)

## Mental model

- `sl.streams` reads raw ordered L1 events from Stacks Streams.
- `sl.index` reads decoded L2 FT/NFT transfer events from Stacks Index.
- `sl.subgraphs` reads app-specific L3 tables from Stacks Subgraphs.

## Stacks Streams

Typed L1 HTTP client. Reads require a bearer token (`apiKey`).

```typescript
const tip = await sl.streams.tip();
// tip.finalized_height — highest immutable (past Bitcoin-anchored finality) block
const page = await sl.streams.events.list({
  types: ["ft_transfer"],
  contractId: "SP...sbtc-token",
  sender: "SP...",       // exact payload sender (events that have one)
  recipient: "SP...",    // exact payload recipient
  assetIdentifier: "SP...token::asset", // exact FT/NFT asset id
  limit: 10,
});
// each event carries `finalized: boolean`
console.log({ tip, firstCursor: page.events[0]?.cursor });
```

`createStreamsClient` remains available for focused Streams-only consumers:

```typescript
import { createStreamsClient } from "@secondlayer/sdk";

const streams = createStreamsClient({
  apiKey: process.env.SL_API_KEY!, // sk-sl_... — required for reads
  // verify: true,                 // verify ed25519 X-Signature on every read
  //                               // (auto-fetches the public key; { publicKey } pins a PEM)
  // dumpsBaseUrl: process.env.SL_STREAMS_DUMPS_URL, // required to use client.dumps
});
```

Verified responses: every Streams read is signed (ed25519 `X-Signature` +
`X-Signature-KeyId`). Pass `verify: true` to check it on every read (or
`{ publicKey }` to pin a PEM); a missing/bad signature throws
`StreamsSignatureError`. The public key is at
`GET /public/streams/signing-key`.

Convenience reads:

```typescript
await sl.streams.canonical(182431);
await sl.streams.events.byTxId("0x...");
await sl.streams.blocks.events(182431);
await sl.streams.blocks.events("0xindex-block-hash");
await sl.streams.reorgs.list({ since: "2026-05-03T00:00:00.000Z" });
```

Checkpointed consumer.

Use `client.events.consume` for indexers and ETL jobs. Write your database rows
inside `onBatch`, then return the cursor you committed. It exits when
`maxPages`, `maxEmptyPolls`, or `signal` stops it.

```typescript
await streams.events.consume({
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
const abort = new AbortController();
process.once("SIGINT", () => abort.abort());

for await (const event of streams.events.stream({
  types: ["ft_transfer"],
  batchSize: 100,
  signal: abort.signal,
})) {
  console.log(event.cursor, event.tx_id);
}
```

Bulk parquet dumps.

Finalized history is published as public parquet files. Set `dumpsBaseUrl`
(or `SL_STREAMS_DUMPS_URL`) — no API key needed for dumps. The SDK does **not**
decode parquet; `download` hands you sha256-verified bytes to process with your
own tooling.

```typescript
const streams = createStreamsClient({
  apiKey: process.env.SL_API_KEY!,
  dumpsBaseUrl: process.env.SL_STREAMS_DUMPS_URL!,
});

const manifest = await streams.dumps.list();       // parse the manifest
for (const file of manifest.files) {
  const bytes = await streams.dumps.download(file); // fetch + verify sha256
  await myParquetReader(bytes);
}
```

Backfill then tail (`events.replay`).

Backfills from bulk dumps, then tails live from the manifest's
`latest_finalized_cursor` — no gap or dupe at the seam. `onDumpFile` hands you
each finalized file; `onBatch` receives live events after the seam.

```typescript
await streams.events.replay({
  from: lastCheckpoint,
  async onDumpFile(file) {
    const bytes = await streams.dumps.download(file);
    await ingestParquet(bytes); // your tooling
  },
  async onBatch(events, envelope) {
    for (const event of events) await handle(event);
    return envelope.next_cursor;
  },
});
```

Decoder helper.

```typescript
import { decodeFtTransfer, isFtTransfer } from "@secondlayer/sdk";

for await (const event of streams.events.stream({ types: ["ft_transfer"] })) {
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

## Stacks Index

Decoded L2 transfer events.

```typescript
const ftPage = await sl.index.ftTransfers.list({
  contractId: "SP...sbtc-token",
  sender: "SP...",
  limit: 100,
});

const nftPage = await sl.index.nftTransfers.list({
  assetIdentifier: "SP...collection::token",
  recipient: "SP...",
});
```

Backfill with SDK walkers:

```typescript
for await (const transfer of sl.index.ftTransfers.walk({
  fromHeight: 0,
  batchSize: 500,
})) {
  console.log(transfer.cursor, transfer.amount);
}
```

## Stacks Subgraphs

Deploy and query app-specific L3 tables.

Subgraphs and subscriptions live on the platform API alongside Streams and Index. Deploying and managing them needs your `sk-sl_` key — no extra setup, no tenant URL.

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

const { count } = await sl.subgraphs.queryTableCount(
  "my-subgraph",
  "transfers",
);

const spec = await sl.subgraphs.openapi("my-subgraph");
const source = await sl.subgraphs.getSource("my-subgraph");
const gaps = await sl.subgraphs.gaps("my-subgraph");

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
    console.log(err.code);    // "NOT_FOUND" (from API's {error, code} envelope, if present)
    console.log(err.message); // "Subgraph not found"
    console.log(err.body);    // full parsed envelope
  }
}
```

Tenant-resolution failures surface as `ApiError` with distinctive codes:

- `code: "TENANT_SUSPENDED"` — your tenant is suspended (see `err.message` for the limit reason)
- `code: "NO_TENANT"` — your account has no provisioned tenant yet
