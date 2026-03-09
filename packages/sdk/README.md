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

## Contracts

Search, inspect, and fetch ABIs for on-chain contracts.

```typescript
// Search by name
const { contracts, total } = await sl.contracts.search("bns", { limit: 10, offset: 0 });

// Get contract detail
const contract = await sl.contracts.get("SP000000000000000000002Q6VF78.bns");
// { contractId, name, deployer, deployBlock, deployTxId, callCount, lastCalledAt, abi, ... }

// Fetch ABI (lazy-cached from Stacks node)
const abi = await sl.contracts.getAbi("SP000000000000000000002Q6VF78.bns");
// { functions: [...], maps: [...], variables: [...], ... }
```

## Streams

Manage real-time event streams with webhook delivery.

```typescript
// Create
const { stream, webhookSecret } = await sl.streams.create({
  name: "my-stream",
  webhookUrl: "https://example.com/webhook",
  filters: { type: "contract_call", contract_id: "SP...token" },
});

// List
const { streams, total } = await sl.streams.list({ status: "active" });

// Get / Update / Delete
const stream = await sl.streams.get("stream-id");
await sl.streams.update("stream-id", { name: "renamed" });
await sl.streams.delete("stream-id");
```

## Views

Deploy and query materialized views.

```typescript
// List
const { data } = await sl.views.list();

// Get
const view = await sl.views.get("my-view");

// Query table
const rows = await sl.views.queryTable("my-view", "transfers", {
  sort: "block_height",
  order: "desc",
  limit: 50,
});

// Typed client (with defineView schema)
import myView from "./views/my-view";
const client = sl.views.typed(myView);
const rows = await client.transfers.findMany({ where: { sender: "SP..." } });
```

## Error Handling

```typescript
import { ApiError } from "@secondlayer/sdk";

try {
  await sl.contracts.get("nonexistent");
} catch (err) {
  if (err instanceof ApiError) {
    console.log(err.status);  // 404
    console.log(err.message); // "Contract not found"
  }
}
```
