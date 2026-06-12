# @secondlayer/mcp

MCP server for Secondlayer's agent-native subgraph platform. Exposes the
golden-path tools only — Index reads, the subgraph lifecycle, subscriptions,
contract discovery/scaffolding, and key self-provisioning. Everything else
(single-record lookups, mempool, stacking, proofs, codegen, billing, projects,
live Streams reads) is available over REST `/v1` + OpenAPI.

## Install

```bash
bun add @secondlayer/mcp
```

## Auth

Most reads are public — `index_*` and `contracts_find` work with no key. Subgraph tools need an `SL_API_KEY`; separately, **public** subgraphs are anon-readable over HTTP at `GET /v1/subgraphs/<name>/<table>` (`{ rows, next_cursor, tip }` cursor envelope), while private ones need the owning account's key (anon → 404). **`streams_dumps` requires an `SL_API_KEY`** (and the Index tools reject free-tier keys — Build+ for keyed access). Writes (deploy, publish/unpublish, reindex, delete, subscriptions) and account tools need a key: create one (prefixed `sk-sl_`) in the platform console at https://secondlayer.tools/platform/api-keys and set it as `SL_API_KEY`. Read `secondlayer://context` first — it reports auth state and read-auth tiers.

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
| **Index** (9) | `index_events`, `index_ft_transfers`, `index_nft_transfers`, `index_contract_calls`, `index_blocks`, `index_transactions`, `index_print_schema`, `index_discover`, `batch_query` |
| **Subgraphs** (11) | `subgraphs_list`, `subgraphs_get`, `subgraphs_deploy`, `subgraphs_publish`, `subgraphs_unpublish`, `subgraphs_delete`, `subgraphs_query`, `subgraphs_backfill`, `subgraphs_reindex`, `subgraphs_stop`, `subgraphs_gaps` |
| **Subscriptions** (7) | `subscriptions_create`, `subscriptions_list`, `subscriptions_get`, `subscriptions_update`, `subscriptions_delete`, `subscriptions_test`, `subscriptions_replay` |
| **Streams** (1) | `streams_dumps` |
| **Contracts** (2) | `contracts_find`, `get_contract_abi` |
| **Scaffold** (1) | `scaffold_from_contract` |
| **Account** (2) | `account_whoami`, `account_create_key` |

Periphery surfaces (single block/tx lookups, mempool, stacking, proofs, usage,
codegen, billing/caps, projects, live Streams reads, delivery forensics) are
REST-only: see the OpenAPI spec at the API host.

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
