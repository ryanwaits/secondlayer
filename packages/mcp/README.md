# @secondlayer/mcp

MCP server for the Second Layer indexing platform.

## Install

```bash
bun add @secondlayer/mcp
```

## Quick Start — Stdio (IDE)

Add to your Claude Desktop or Cursor config:

```json
{
  "mcpServers": {
    "secondlayer": {
      "command": "npx",
      "args": ["@secondlayer/mcp"],
      "env": {
        "SECONDLAYER_API_KEY": "sl_live_..."
      }
    }
  }
}
```

## Quick Start — HTTP (Remote)

```bash
export SECONDLAYER_API_KEY=sl_live_...
export SECONDLAYER_MCP_SECRET=your-secret
npx @secondlayer/mcp-http
# Listening on port 3100
```

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SECONDLAYER_API_KEY` | Yes | — | API key |
| `SECONDLAYER_MCP_PORT` | No | `3100` | HTTP transport port |
| `SECONDLAYER_MCP_SECRET` | No | — | Bearer token for HTTP auth. Disabled if unset. |

## Tools

19 tools across 4 domains.

| Domain | Tools |
| --- | --- |
| **Streams** (9) | `streams_list`, `streams_get`, `streams_create`, `streams_update`, `streams_delete`, `streams_toggle`, `streams_deliveries`, `streams_pause_all`, `streams_resume_all` |
| **Subgraphs** (6) | `subgraphs_list`, `subgraphs_get`, `subgraphs_query`, `subgraphs_reindex`, `subgraphs_delete`, `subgraphs_deploy` |
| **Scaffold** (2) | `scaffold_from_contract`, `scaffold_from_abi` |
| **Templates** (2) | `templates_list`, `templates_get` |

## Programmatic Usage

```typescript
import { createServer } from "@secondlayer/mcp";

const server = createServer();
// Connect to your own transport
```

## License

MIT
