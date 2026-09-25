# @secondlayer/mcp

Gives your coding agent direct access to the Stacks data on your own instance —
Index (decoded rows), Subgraphs (tables you define, served from your instance),
and Streams (raw inputs). Exposes the golden-path tools only: Index reads, the
subgraph lifecycle, webhooks, contract discovery/scaffolding, instance
status, archive verify/bootstrap, and hosted credits/quote. Everything else
(single-record lookups, mempool, stacking, proofs, live Streams reads) is
available over REST `/v1` + OpenAPI. There is no `consume` tool.

## Install

```bash
bun add @secondlayer/mcp
```

## Auth

Most reads are public: `index_*` and `contracts_find` work with no key. Subgraph tools need an `INSTANCE_TOKEN` past loopback, and so does `GET /v1/subgraphs/<name>/<table>` over HTTP (`{ rows, next_cursor, tip }` cursor envelope); on loopback it is open. There is no per-subgraph public or private flag. `streams_dumps` needs no key: the dumps manifest is public; the tool only needs `SL_STREAMS_DUMPS_URL` configured. `streams_tip` is key-mandatory (keyless → 401). Live Streams list reads are REST-only (`GET /v1/streams/*`). Writes (deploy, reindex, delete, webhooks) need a key: set `INSTANCE_TOKEN` from `secondlayer init`. Hosted credits/quote use `SECONDLAYER_API_KEY` (`sk-sl_*`). Read `secondlayer://context` first: it reports auth state and read-auth tiers.

## Quick Start — Stdio (IDE)

Add to your Claude Desktop or Cursor config:

```json
{
  "mcpServers": {
    "secondlayer": {
      "command": "bunx",
      "args": ["-p", "@secondlayer/mcp", "secondlayer-mcp"],
      "env": {
        "SECONDLAYER_API_URL": "http://127.0.0.1:3800",
        "INSTANCE_TOKEN": "..."
      }
    }
  }
}
```

## Quick Start — HTTP (Remote)

```bash
export SECONDLAYER_API_URL=http://127.0.0.1:3800
export INSTANCE_TOKEN=<from secondlayer init>
export SECONDLAYER_MCP_SECRET=your-secret
bunx -p @secondlayer/mcp secondlayer-mcp-http
# Listening on port 3100
```

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `INSTANCE_TOKEN` | Writes only | — | From `secondlayer init`. Required for write tools; reads are public. Not valid for hosted credits. |
| `SECONDLAYER_API_KEY` | Hosted credits/quote/latest | — | `sk-sl_*` for `api.secondlayer.tools`. |
| `SECONDLAYER_API_URL` | No | `http://127.0.0.1:3800` | Instance API. |
| `SECONDLAYER_BIN` | CLI tools | `secondlayer` on PATH | Path to the CLI binary (`setup`, `bootstrap`, `repair`). |
| `SECONDLAYER_CWD` | CLI tools | process cwd | Compose project directory. |
| `SECONDLAYER_MCP_PORT` | No | `3100` | HTTP transport port. |
| `SECONDLAYER_MCP_SECRET` | No | — | Bearer token for HTTP auth. Disabled if unset. |

## Tools

| Domain | Tools |
| --- | --- |
| **Index** (9) | `index_events`, `index_ft_transfers`, `index_nft_transfers`, `index_contract_calls`, `index_blocks`, `index_transactions`, `index_print_schema`, `index_discover`, `batch_query` |
| **Subgraphs** (12) | `subgraphs_list`, `subgraphs_status`, `subgraphs_spec`, `subgraphs_scaffold`, `subgraphs_deploy`, `subgraphs_delete`, `subgraphs_query`, `subgraphs_backfill`, `subgraphs_reindex`, `subgraphs_stop`, `subgraphs_operations`, `subgraphs_gaps` |
| **Webhooks** (13) | `webhooks_create`, `webhooks_list`, `webhooks_get`, `webhooks_update`, `webhooks_delete`, `webhooks_test`, `webhooks_pause`, `webhooks_resume`, `webhooks_rotate_secret`, `webhooks_deliveries`, `webhooks_dead`, `webhooks_requeue`, `webhooks_replay` |
| **Streams** (2) | `streams_tip`, `streams_dumps` |
| **Contracts** (2) | `contracts_find`, `contracts_get_abi` |
| **Instance** (1) | `instance_status` |
| **Archive** (5) | `archive_verify`, `archive_bootstrap`, `archive_repair`, `archive_latest`, `archive_quote` |
| **Setup** (1) | `setup` |
| **Credits** (1) | `credits_balance` (needs `SECONDLAYER_API_KEY`) |
| **Account** (2) | `account_whoami`, `account_create_key` (only when pointed at `https://api.secondlayer.tools`) |

Verify after mutating: `subgraphs_operations` for deploy/reindex/backfill/stop,
`webhooks_deliveries` for create/test/replay. Empty index: `setup` or
`archive_bootstrap`, poll `instance_status` until decoders are ok, then
`archive_verify`, then `codegen_index_schema`.

Periphery surfaces (single block/tx lookups, mempool, stacking, proofs,
credits/caps, live Streams reads/SSE) are REST-only: see the OpenAPI spec at
the API host. Live Streams list reads use `GET /v1/streams/events`.

Point the server at your instance with `SECONDLAYER_API_URL` (default
`http://127.0.0.1:3800`). Writes use `INSTANCE_TOKEN` from
`secondlayer init`. `account_*` tools appear only when the server is pointed at
`https://api.secondlayer.tools`.

### `webhooks_create` kinds

Webhooks are polymorphic. Pass `subgraphName` + `tableName` for a
**subgraph** webhook, or a `triggers` array for a **chain** webhook —
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
| `secondlayer://context` | Live state — what exists (your subgraphs, webhooks, account), what you can do, and read-auth tiers. Read first. |
| `secondlayer://filters` | Subgraph source filter types and their fields |
| `secondlayer://column-types` | Column type mappings and options |
| `secondlayer://traits` | SIP trait standards (valid `trait` values) |
| `secondlayer://chain-triggers` | Chain-webhook trigger types and fields |

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
