# @secondlayer/mcp

MCP server for Secondlayer's agent-native subgraph platform.

## Install

```bash
bun add @secondlayer/mcp
```

## Auth

Reads are public — `list`, `get`, `query`, and `spec` tools work with no key. Writes (deploy, reindex, delete, subscriptions) and account tools need a key: create one (prefixed `sk-sl_`) in the platform console at https://secondlayer.tools/platform/api-keys and set it as `SL_API_KEY`.

## Quick Start — Stdio (IDE)

Add to your Claude Desktop or Cursor config:

```json
{
  "mcpServers": {
    "secondlayer": {
      "command": "bunx",
      "args": ["-p", "@secondlayer/mcp", "secondlayer-mcp"],
      "env": {
        "SL_API_KEY": "sk-sl_..."
      }
    }
  }
}
```

## Quick Start — HTTP (Remote)

```bash
export SL_API_KEY=sk-sl_...
export SECONDLAYER_MCP_SECRET=your-secret
bunx -p @secondlayer/mcp secondlayer-mcp-http
# Listening on port 3100
```

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SL_API_KEY` | Writes only | — | An `sk-sl_` API key from the platform console (https://secondlayer.tools/platform/api-keys). Required for write/account tools; reads are public. |
| `SECONDLAYER_API_URL` | No | `https://api.secondlayer.tools` | Base API URL. Point at a local instance for dev. |
| `SECONDLAYER_MCP_PORT` | No | `3100` | HTTP transport port. |
| `SECONDLAYER_MCP_SECRET` | No | — | Bearer token for HTTP auth. Disabled if unset. |

## Tools

| Domain | Tools |
| --- | --- |
| **Subgraphs** (7) | `subgraphs_list`, `subgraphs_get`, `subgraphs_query`, `subgraphs_reindex`, `subgraphs_delete`, `subgraphs_deploy`, `subgraphs_read_source` |
| **Subscriptions** (12) | `subscriptions_list`, `subscriptions_get`, `subscriptions_create`, `subscriptions_update`, `subscriptions_pause`, `subscriptions_resume`, `subscriptions_delete`, `subscriptions_rotate_secret`, `subscriptions_replay`, `subscriptions_recent_deliveries`, `subscriptions_dead`, `subscriptions_requeue_dead` |
| **Scaffold** (2) | `scaffold_from_contract`, `scaffold_from_abi` |
| **Account** (1) | `account_whoami` |

### `subgraphs_query` enhancements

- `fields` — comma-separated column projection (e.g. `"sender,amount_x"`)
- `count` — boolean, returns row count instead of rows
- Filter operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`
- Max limit: 200

## Resources

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

Bundle/deploy errors use descriptive prefixes: `"Bundle failed:"`, `"Module evaluation failed:"`, `"Validation failed:"`. HTTP transport enforces a 1MB body limit (413) and JSON parse safety (400). Scaffold ABI fetch has a 10s timeout.

## Programmatic Usage

```typescript
import { createServer } from "@secondlayer/mcp";

const server = createServer();
// Connect to your own transport
```

## License

MIT
