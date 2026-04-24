---
name: secondlayer
description: Build and operate Secondlayer Stacks subgraphs, table subscriptions, CLI, SDK, and MCP workflows with an agent-native loop.
---

# Secondlayer

Secondlayer indexes Stacks blockchain activity into typed Postgres tables and
delivers row changes to HTTP receivers.

Use this skill when the user asks for Secondlayer, `sl`, Stacks indexing,
subgraphs, webhooks/subscriptions, MCP setup, SDK wiring, or recovery work.

## Default Loop

1. Identify intent and the target account/project.
2. Inspect current state before changing anything.
3. Scaffold, edit, or create the smallest correct artifact.
4. Validate locally or through `sl`/MCP.
5. Ask for human confirmation before deploy, destructive actions, secret
   rotation, replay, or requeue.
6. Verify after the action.
7. If delivery/indexing fails, diagnose before retrying.

## Setup

Prefer Bun commands.

```bash
bun add -g @secondlayer/cli
sl login
sl whoami
```

For project-local packages:

```bash
bun add @secondlayer/sdk
bun add @secondlayer/subgraphs
bun add -d @secondlayer/mcp
```

## Task Router

### Subgraphs

Read `references/subgraphs.md` before authoring or editing a subgraph.
Read `references/subgraph-patterns.md` for examples.
Read `references/filters.md` and `references/column-types.md` when choosing
sources, filters, columns, indexes, or unique keys.

Use current commands:

```bash
sl subgraphs scaffold SP123.contract-name --output subgraphs/my-subgraph.ts
sl subgraphs deploy subgraphs/my-subgraph.ts
sl subgraphs deploy subgraphs/my-subgraph.ts --reindex
sl subgraphs status my-subgraph
sl subgraphs query my-subgraph table_name --limit 10
sl subgraphs generate my-subgraph -o src/secondlayer/my-subgraph.ts
```

Important contracts:

- `defineSubgraph()` uses named object `sources`.
- Handler keys match `sources` keys; `"*"` is the catch-all.
- Handler payloads use unwrapped event objects. Print event fields live at
  `event.data`; transfer fields are top-level.
- Writes are batched per block through `ctx.insert`, `ctx.patch`, `ctx.upsert`,
  `ctx.delete`, and `ctx.patchOrInsert`.

### Subscriptions

Read `references/subscriptions.md` before creating or managing subscriptions.
Read `references/troubleshooting.md` before replaying or requeueing.

Subscription loop:

1. Confirm the subgraph and table exist.
2. Ask only for missing receiver details: runtime and URL.
3. Create the receiver/subscription.
4. Surface the `signingSecret` exactly once and tell the user to store it
   server-side.
5. Generate a signed test fixture only from a user-provided secret.
6. Diagnose failures with deliveries, dead letters, and linked subgraph state.

Commands:

```bash
sl create subscription whale-alerts --runtime node
sl subscriptions list
sl subscriptions get whale-alerts
sl subscriptions update whale-alerts --url https://example.com/hooks/sl
sl subscriptions pause whale-alerts
sl subscriptions resume whale-alerts
sl subscriptions rotate-secret whale-alerts
sl subscriptions deliveries whale-alerts
sl subscriptions dead whale-alerts
sl subscriptions requeue whale-alerts <outbox-id>
sl subscriptions replay whale-alerts --from-block 180000 --to-block 181000
sl subscriptions doctor whale-alerts
sl subscriptions test whale-alerts --signing-secret "$SIGNING_SECRET"
```

Human-confirm `delete`, `rotate-secret`, `replay`, and `requeue`.

### MCP

Read `references/mcp.md` before configuring or using MCP.

Use MCP when the user wants an agent to inspect, deploy, query, create
subscriptions, pause/resume, rotate secrets, replay, inspect deliveries/dead
letters, or requeue without shelling out.

```json
{
  "mcpServers": {
    "secondlayer": {
      "command": "bunx",
      "args": ["@secondlayer/mcp"],
      "env": {
        "SL_SERVICE_KEY": "sk-sl_..."
      }
    }
  }
}
```

### CLI

Use `sl` for local, terminal-first workflows. Prefer `--json` for inspection
when the result feeds another step.

Core commands:

```bash
sl login
sl project current
sl instance info
sl subgraphs list --json
sl subscriptions list --json
sl doctor
```

### SDK

Use `@secondlayer/sdk` for app code. Prefer typed subgraph clients via
`getSubgraph(definition, client)` when the app owns the subgraph source.

Use SDK subscriptions for product code that creates, pauses, resumes, rotates,
replays, reads deliveries, reads dead letters, or requeues dead rows.

### Troubleshooting

Read `references/troubleshooting.md` when:

- a subgraph is behind, stalled, or in error;
- a subscription is paused or erroring;
- deliveries return 4xx/5xx/timeouts;
- dead-letter rows exist;
- the user asks to replay or requeue.

Never replay a large block range until you have inspected current delivery
health and confirmed the exact range with the user.

## Reference Map

- `references/subgraphs.md` — current `defineSubgraph` contract and handler API.
- `references/subgraph-patterns.md` — working source/handler examples.
- `references/filters.md` — 13 source filter types.
- `references/column-types.md` — subgraph column types and schema options.
- `references/subscriptions.md` — create/update, formats, lifecycle, doctor,
  test, replay, and DLQ.
- `references/mcp.md` — MCP setup and full tool parity.
- `references/troubleshooting.md` — recovery paths for indexing and delivery.
