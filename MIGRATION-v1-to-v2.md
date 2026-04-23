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

Subgraph typed event subscriptions (Sprint 3+) emit HTTP webhooks to your runtime of choice. `sl create subscription <name> --runtime <inngest|trigger|cloudflare|node>` scaffolds a receiver project wired to a subscription.

Full guide lands in Sprint 7 under `/docs/migration/v1-to-v2`.
