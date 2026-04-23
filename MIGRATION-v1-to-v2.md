# Secondlayer v1 → v2 migration (stub)

## Breaking changes

- `@secondlayer/workflows`, `@secondlayer/workflow-runner`, `@secondlayer/sentries` are **removed**. No drop-in replacement — the product refocus moves durable execution out of Secondlayer; users bring their own runtime (Inngest / Trigger.dev / Cloudflare Workflows / Node).
- `@secondlayer/sdk` no longer exposes `sl.sentries.*`.
- `@secondlayer/mcp` no longer exposes `manage_sentries`, `check_sentries`, `list_sentry_kinds`.
- Dashboard `/sentries` pages are gone.

## ⚠️ MCP restart required

MCP tool schemas are cached by the client. After upgrading `@secondlayer/mcp`:

- **Claude Code**: `claude mcp restart secondlayer`
- **Cursor**: reload window (`Cmd+Shift+P` → "Reload Window")
- **Other MCP clients**: restart the client so it re-handshakes with the new tool set

Without a restart, calls to the removed sentry tools will surface as "tool not found" errors.

## What replaces it

Subgraph typed event subscriptions emit HTTP webhooks to your runtime of choice. `sl create subscription <name> --runtime <inngest|trigger|cloudflare|node>` (Sprint 4) scaffolds a receiver project wired to a subscription.

## ⚠️ Postgres connection mode

The subscription emitter keeps a persistent `LISTEN` on `subscriptions:new_outbox` and `subscriptions:changed`, so it MUST connect through a **session-mode** pool. pgbouncer's **transaction-mode** pool silently breaks `LISTEN` because server connections are swapped between transactions.

- docker-compose local dev: default `postgres://` goes straight to Postgres, no pooler — works out of the box.
- Dedicated hosting: each tenant container gets a direct session-mode connection from the provisioner.
- Self-host with pgbouncer: run the emitter against the **session-mode** port (often `:6432` with `pool_mode=session`), NOT the transaction-mode port.

If you see the emitter logging `[emitter] started` but no deliveries fire when you insert outbox rows, verify your pooler mode.

Full guide lands in Sprint 7 under `/docs/migration/v1-to-v2`.
