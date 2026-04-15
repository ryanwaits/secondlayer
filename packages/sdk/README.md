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

## Workflows

Deploy and manage automated workflows.

```typescript
// List
const { workflows } = await sl.workflows.list();

// Get
const detail = await sl.workflows.get("whale-alerts");

// Deploy
const result = await sl.workflows.deploy({
  name: "whale-alerts",
  trigger: { type: "event", filter: { type: "stx_transfer" } },
  handlerCode: "...",
});

// Trigger manually
const { runId } = await sl.workflows.trigger("whale-alerts", { threshold: 100000 });

// Pause / Resume / Delete
await sl.workflows.pause("whale-alerts");
await sl.workflows.resume("whale-alerts");
await sl.workflows.delete("whale-alerts");

// List runs
const { runs } = await sl.workflows.listRuns("whale-alerts", { status: "completed", limit: 10 });

// Get run details
const run = await sl.workflows.getRun("run-id");
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
