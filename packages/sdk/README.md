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

Manage real-time event streams with endpoint delivery.

```typescript
// Create
const { stream, signingSecret } = await sl.streams.create({
  name: "my-stream",
  endpointUrl: "https://example.com/receive",
  filters: { type: "contract_call", contract_id: "SP...token" },
});

// List
const { streams, total } = await sl.streams.list({ status: "active" });

// Get / Update / Delete
const stream = await sl.streams.get("stream-id");
await sl.streams.update("stream-id", { name: "renamed" });
await sl.streams.delete("stream-id");
```

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
