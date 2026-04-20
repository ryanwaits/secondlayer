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
        "SL_SERVICE_KEY": "sl_live_..."
      }
    }
  }
}
```

## Quick Start — HTTP (Remote)

```bash
export SL_SERVICE_KEY=sl_live_...
export SECONDLAYER_MCP_SECRET=your-secret
npx @secondlayer/mcp-http
# Listening on port 3100
```

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SL_SERVICE_KEY` | Yes | — | Tenant service key. `SECONDLAYER_API_KEY` is still accepted as a deprecated alias. |
| `SECONDLAYER_MCP_PORT` | No | `3100` | HTTP transport port |
| `SECONDLAYER_MCP_SECRET` | No | — | Bearer token for HTTP auth. Disabled if unset. |

## Tools

Tools across 4 domains.

| Domain | Tools |
| --- | --- |
| **Subgraphs** (6) | `subgraphs_list`, `subgraphs_get`, `subgraphs_query`, `subgraphs_reindex`, `subgraphs_delete`, `subgraphs_deploy` |
| **Workflows** (6) | `workflows_list`, `workflows_get`, `workflows_trigger`, `workflows_pause`, `workflows_resume`, `workflows_runs` |
| **Scaffold** (2) | `scaffold_from_contract`, `scaffold_from_abi` |
| **Account** (1) | `account_whoami` |

### `subgraphs_query` enhancements

- `fields` — comma-separated column projection (e.g. `"sender,amount_x"`)
- `count` — boolean, returns row count instead of rows
- Filter operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`
- Max limit raised from 50 to 200

## Resources

2 MCP resources for agent context:

| URI | Description |
| --- | --- |
| `secondlayer://filters` | Filter types reference |
| `secondlayer://column-types` | Column type mappings and options |

## Error Handling

All tools return structured errors with `isError: true`:

```json
{ "error": { "type": "not_found", "status": 404, "message": "Subgraph not found" } }
```

| Error type | Status | When |
| --- | --- | --- |
| `unauthorized` | 401 | Invalid or missing API key |
| `not_found` | 404 | Resource doesn't exist |
| `rate_limited` | 429 | Too many requests |
| `server_error` | 5xx | Server-side failure |
| `error` | other | Validation, bundling, etc. |

Bundle/deploy errors use descriptive prefixes: `"Bundle failed:"`, `"Module evaluation failed:"`, `"Validation failed:"`.

HTTP transport enforces a 1MB body limit (413) and JSON parse safety (400). Scaffold ABI fetch has a 10s timeout.

## Programmatic Usage

```typescript
import { createServer } from "@secondlayer/mcp";

const server = createServer();
// Connect to your own transport
```

## License

MIT
