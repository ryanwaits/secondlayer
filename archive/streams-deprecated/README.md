# Streams Feature Archive

This directory contains a complete snapshot of the Streams feature code
before deprecation. Streams has been removed from Secondlayer in favor
of Workflows, which provide the same webhook delivery capabilities
plus additional features (AI enrichment, retries, conditional logic).

## Contents

- `sdk/` - SDK client and types
- `api/` - REST API routes
- `cli/` - CLI commands
- `shared/` - Shared schemas
- `mcp/` - MCP server tools
- `web/` - Web UI pages and components
- `scaffold/` - Code generation templates
- `account-agent/` - Account agent tools
- `worker/` - Worker processor
- `workflows/` - StreamTrigger types

## Migration Path

Users should migrate from Streams to Workflows using the simple-webhook
template, which provides identical functionality.

## Date Archived

2026-04-14
