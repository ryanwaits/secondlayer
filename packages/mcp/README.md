# @secondlayer/mcp

Gives your coding agent direct access to the Stacks data on your own instance —
Index (decoded rows), Subgraphs (tables you define, served from your instance),
and Streams (raw inputs). Exposes the golden-path tools only: Index reads, the
subgraph lifecycle, subscriptions, and contract discovery/scaffolding.
Everything else (single-record lookups, mempool, stacking, proofs, codegen,
credits, live Streams reads) is available over REST `/v1` + OpenAPI.

## Install

```bash
bun add @secondlayer/mcp
```

## Auth

Most reads are public: `index_*` and `contracts_find` work with no key. Subgraph tools need an `INSTANCE_TOKEN` past loopback; separately, **public** subgraphs are anon-readable over HTTP at `GET /v1/subgraphs/<name>/<table>` (`{ rows, next_cursor, tip }` cursor envelope), while private ones need the instance token (anon → 404). `streams_dumps` needs no key: the dumps manifest is public; the tool only needs `SL_STREAMS_DUMPS_URL` configured. Every other `streams_*` tool is key-mandatory (keyless → 401). Writes (deploy, reindex, delete, subscriptions) need a key: set `INSTANCE_TOKEN` from `secondlayer init`. `SL_API_KEY` is a legacy alias of `INSTANCE_TOKEN`. Read `secondlayer://context` first: it reports auth state and read-auth tiers.

## Quick Start — Stdio (IDE)

Add to your Claude Desktop or Cursor config:

```json
{
  "mcpServers": {
    "secondlayer": {
      "command": "bunx",
      "args": ["-p", "@secondlayer/mcp", "secondlayer-mcp"],
      "env": {
        "SL_API_URL": "http://127.0.0.1:3800",
        "INSTANCE_TOKEN": "..."
      }
    }
  }
}
```

## Quick Start — HTTP (Remote)

```bash
export SL_API_URL=http://127.0.0.1:3800
export INSTANCE_TOKEN=<from secondlayer init>
export SECONDLAYER_MCP_SECRET=your-secret
bunx -p @secondlayer/mcp secondlayer-mcp-http
# Listening on port 3100
```

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `INSTANCE_TOKEN` | Writes only | — | From `secondlayer init`. Required for write tools; reads are public. `SL_API_KEY` is a legacy alias. |
| `SL_API_URL` | No | `http://127.0.0.1:3800` | Instance API. |
| `SECONDLAYER_API_URL` | No | — | Overrides `SL_API_URL`. |
| `SECONDLAYER_MCP_PORT` | No | `3100` | HTTP transport port. |
| `SECONDLAYER_MCP_SECRET` | No | — | Bearer token for HTTP auth. Disabled if unset. |

## Tools

| Domain | Tools |
| --- | --- |
| **Index** (9) | `index_events`, `index_ft_transfers`, `index_nft_transfers`, `index_contract_calls`, `index_blocks`, `index_transactions`, `index_print_schema`, `index_discover`, `batch_query` |
| **Subgraphs** (12) | `subgraphs_list`, `subgraphs_status`, `subgraphs_spec`, `subgraphs_scaffold`, `subgraphs_deploy`, `subgraphs_delete`, `subgraphs_query`, `subgraphs_backfill`, `subgraphs_reindex`, `subgraphs_stop`, `subgraphs_operations`, `subgraphs_gaps` |
| **Subscriptions** (13) | `subscriptions_create`, `subscriptions_list`, `subscriptions_get`, `subscriptions_update`, `subscriptions_delete`, `subscriptions_test`, `subscriptions_pause`, `subscriptions_resume`, `subscriptions_rotate_secret`, `subscriptions_deliveries`, `subscriptions_dead`, `subscriptions_requeue`, `subscriptions_replay` |
| **Streams** (7) | `streams_tip`, `streams_events`, `streams_events_by_tx`, `streams_block_events`, `streams_canonical`, `streams_reorgs`, `streams_dumps` |
| **Contracts** (2) | `contracts_find`, `contracts_get_abi` |
| **Account** (2) | `account_whoami`, `account_create_key` (only when pointed at `https://api.secondlayer.tools`) |

Verify after mutating: `subgraphs_operations` for deploy/reindex/backfill/stop,
`subscriptions_deliveries` for create/test/replay.

Periphery surfaces (single block/tx lookups, mempool, stacking, proofs,
credits/caps, live Streams SSE) are REST-only: see the OpenAPI spec at the API
host. Following the chain over MCP means polling `streams_events` with a cursor.

Point the server at your instance with `SL_API_URL` (default
`http://127.0.0.1:3800`). Writes use `INSTANCE_TOKEN` from
`secondlayer init`. `account_*` tools appear only when the server is pointed at
`https://api.secondlayer.tools`.

### `subscriptions_create` kinds

Subscriptions are polymorphic. Pass `subgraphName` + `tableName` for a
**subgraph** subscription, or a `triggers` array for a **chain** subscription —
a webhook on raw chain events (contract / event / function / trait) with no
subgraph (e.g. `[{ "type": "contract_call", "contractId": "SP....amm",
"functionName": "swap-*" }]`).

### `subgraphs_query` enhancements

- `fields` — comma-separated column projection (e.g. `"sender,amount_x"`)
- `count` — boolean, returns row count instead of rows
- Filter operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`
- Max limit: 200

## Resources

| URI | Description |
| --- | --- |
| `secondlayer://context` | Live state — what exists (your subgraphs, subscriptions, account), what you can do, and read-auth tiers. Read first. |
| `secondlayer://filters` | Subgraph source filter types and their fields |
| `secondlayer://column-types` | Column type mappings and options |
| `secondlayer://traits` | SIP trait standards (valid `trait` values) |
| `secondlayer://chain-triggers` | Chain-subscription trigger types and fields |

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
