# @secondlayer/workflows

Define and deploy event-driven workflows on Secondlayer.

## Quick Start

```typescript
import { defineWorkflow } from "@secondlayer/workflows";

export default defineWorkflow({
  name: "whale-alerts",
  trigger: {
    type: "event",
    filter: { type: "stx_transfer" },
  },
  handler: async ({ event, step }) => {
    const analysis = await step.ai("analyze", {
      prompt: `Analyze this transfer: ${JSON.stringify(event)}`,
      model: "haiku",
    });

    await step.deliver("notify", {
      type: "slack",
      channel: "#alerts",
      text: `Whale alert: ${JSON.stringify(analysis)}`,
    });
  },
});
```

## Triggers

### Event (on-chain)

```typescript
{ type: "event", filter: { type: "contract_call", contract: "SP..." } }
```

### Stream (continuous)

```typescript
{ type: "stream", filter: { type: "stx_transfer" } }
```

### Schedule (cron)

```typescript
{ type: "schedule", cron: "0 */6 * * *", timezone: "America/Chicago" }
```

### Manual

```typescript
{
  type: "manual",
  input: {
    address: { type: "string", required: true, description: "Wallet address" },
    threshold: { type: "number", default: 100000 },
  },
}
```

## Step Methods

All steps are memoized — re-running a workflow skips completed steps automatically.

### `step.run(id, fn)`

Generic async execution.

```typescript
const balance = await step.run("fetch-balance", async () => {
  const res = await fetch(`https://api.example.com/balance/${address}`);
  return res.json();
});
```

### `step.ai(id, options)`

Call Claude with optional structured output.

```typescript
const result = await step.ai("classify", {
  prompt: "Classify this transaction as spam or legitimate",
  model: "haiku", // or "sonnet"
  schema: {
    classification: { type: "string", description: "spam or legitimate" },
    confidence: { type: "number", description: "0-1 confidence score" },
  },
});
```

### `step.query(subgraph, table, options?)` / `step.query(id, subgraph, table, options?)`

Query a subgraph table. Pass an explicit `id` to avoid memoization issues if table names change.

```typescript
// Auto-generated memoization key
const txs = await step.query("my-indexer", "transfers", {
  where: { sender: { eq: "SP..." }, amount: { gte: 100000 } },
  orderBy: { block_height: "desc" },
  limit: 10,
});

// Explicit memoization key (recommended)
const txs = await step.query("recent-transfers", "my-indexer", "transfers", {
  where: { amount: { gte: 100000 } },
  limit: 10,
});
```

**Where operators:** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`

### `step.count(subgraph, table, where?)` / `step.count(id, subgraph, table, where?)`

Count rows in a subgraph table.

```typescript
const total = await step.count("my-indexer", "transfers", {
  sender: "SP...",
});

// With explicit ID
const total = await step.count("whale-count", "my-indexer", "transfers", {
  amount: { gte: 1000000 },
});
```

### `step.deliver(id, target)`

Send notifications via webhook, Slack, email, Discord, or Telegram.

```typescript
// Webhook
await step.deliver("webhook", {
  type: "webhook",
  url: "https://example.com/hook",
  body: { event: "whale_transfer", amount: 500000 },
  headers: { Authorization: "Bearer ..." },
});

// Email
await step.deliver("email", {
  type: "email",
  to: "team@example.com",
  subject: "Whale Alert",
  body: "Large transfer detected...",
});

// Discord
await step.deliver("discord", {
  type: "discord",
  webhookUrl: "https://discord.com/api/webhooks/...",
  content: "Whale alert!",
});

// Telegram
await step.deliver("telegram", {
  type: "telegram",
  botToken: "...",
  chatId: "...",
  text: "Whale alert!",
  parseMode: "HTML",
});
```

### `step.sleep(id, ms)`

Pause the workflow and resume later. The worker is freed during sleep.

```typescript
await step.sleep("wait-5m", 5 * 60 * 1000);
```

### `step.invoke(id, options)`

Trigger another workflow (fire-and-forget).

```typescript
await step.invoke("start-followup", {
  workflow: "detailed-analysis",
  input: { txId: "0x..." },
});
```

### `step.mcp(id, options)`

Call an MCP server tool.

```typescript
const result = await step.mcp("lookup", {
  server: "blockchain-tools",
  tool: "get_transaction",
  args: { txId: "0x..." },
});
```

## Retry Config

```typescript
defineWorkflow({
  name: "resilient-workflow",
  trigger: { type: "schedule", cron: "0 * * * *" },
  retries: {
    maxAttempts: 5,
    backoffMs: 1000,       // initial delay
    backoffMultiplier: 2,  // exponential: 1s, 2s, 4s, 8s, 16s
  },
  timeout: 120_000, // 2 minute timeout
  handler: async ({ step }) => { /* ... */ },
});
```

## CLI

```bash
sl workflows validate <file>     # Dry-run validation
sl workflows deploy <file>       # Validate and deploy
sl workflows list                # List all workflows
sl workflows get <name>          # Get workflow details
sl workflows trigger <name>      # Trigger manual workflow
sl workflows runs <name>         # List runs
sl workflows pause <name>        # Pause workflow
sl workflows resume <name>       # Resume paused workflow
sl workflows delete <name>       # Delete workflow
```
