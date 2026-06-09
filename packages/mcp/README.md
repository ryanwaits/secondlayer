# @secondlayer/mcp

MCP server for Secondlayer's agent-native subgraph platform.

## Install

```bash
bun add @secondlayer/mcp
```

## Auth

Most reads are public — `datasets_*`, `index_*`, and `contracts_find` work with no key. Subgraph tools need an `SL_API_KEY`; separately, **public** subgraphs are anon-readable over HTTP at `GET /v1/subgraphs/<name>/<table>` (`{ rows, next_cursor, tip }` cursor envelope), while private ones need the owning account's key (anon → 404). **`streams_*` requires an `SL_API_KEY`** (and the Index tools reject free-tier keys — Build+ for keyed access). Writes (deploy, publish/unpublish, reindex, delete, subscriptions) and account tools need a key: create one (prefixed `sk-sl_`) in the platform console at https://secondlayer.tools/platform/api-keys and set it as `SL_API_KEY`. Read `secondlayer://context` first — it reports auth state and read-auth tiers.

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
| **Subgraphs** (16) | `subgraphs_list`, `subgraphs_get`, `subgraphs_spec`, `subgraphs_query`, `subgraphs_aggregate`, `subgraphs_reindex`, `subgraphs_operation`, `subgraphs_backfill`, `subgraphs_stop`, `subgraphs_gaps`, `subgraphs_delete`, `subgraphs_deploy`, `subgraphs_publish`, `subgraphs_unpublish`, `subgraphs_read_source`, `subgraphs_codegen` |
| **Subscriptions** (12) | `subscriptions_list`, `subscriptions_get`, `subscriptions_create`, `subscriptions_update`, `subscriptions_pause`, `subscriptions_resume`, `subscriptions_delete`, `subscriptions_rotate_secret`, `subscriptions_replay`, `subscriptions_recent_deliveries`, `subscriptions_dead`, `subscriptions_requeue_dead` |
| **Datasets** (2) | `datasets_list`, `datasets_query` |
| **Index** (4) | `index_ft_transfers`, `index_nft_transfers`, `index_events`, `index_contract_calls` |
| **Streams** (2) | `streams_tip`, `streams_events` |
| **Contracts** (1) | `contracts_find` |
| **Scaffold** (2) | `scaffold_from_contract`, `scaffold_from_abi` |
| **Account** (4) | `account_whoami`, `account_update`, `account_billing`, `account_create_key` |

`account_create_key` mints a scoped `streams`/`index` read key — requires an
account/owner key and returns the `sk-sl_` key **once**. **Key products:** an
`account` key (dashboard default) grants both `streams:read` and `index:read` and
is the only key that can mint; `streams`/`index` keys are scoped reads and cannot
mint (403).

### `subscriptions_create` kinds

Subscriptions are polymorphic. Pass `subgraphName` + `tableName` for a
**subgraph** subscription, or a `triggers` array for a **chain** subscription —
a webhook on raw chain events (contract / event / function / trait) with no
subgraph (e.g. `[{ "type": "contract_call", "contractId": "SP....amm",
"functionName": "swap-*" }]`).

### Subgraph visibility

`subgraphs_deploy` takes a `visibility` param (`public` | `private`; defaults: managed → public, BYO `databaseUrl` → private). Flip later with `subgraphs_publish` / `subgraphs_unpublish` — publishing claims the name in the single global public namespace (409 `PUBLIC_NAME_TAKEN` if claimed). Public subgraphs are anon-readable at `GET /v1/subgraphs/<name>/<table>`.

### `subgraphs_query` enhancements

- `fields` — comma-separated column projection (e.g. `"sender,amount_x"`)
- `count` — boolean, returns row count instead of rows
- Filter operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`
- Max limit: 200

### `subgraphs_aggregate`

Scalar aggregates over the same filtered set as `subgraphs_query`:

- `count` — `COUNT(*)` of matching rows
- `countDistinct` — columns to count distinct values of
- `sum` / `min` / `max` — numeric columns only (`uint`/`int` + system `_block_height`); returned as lossless strings
- No aggregate requested → returns the row count.

## Resources

| URI | Description |
| --- | --- |
| `secondlayer://context` | Live state — what exists (your subgraphs, subscriptions, account), what you can do, and read-auth tiers. Read first. |
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
