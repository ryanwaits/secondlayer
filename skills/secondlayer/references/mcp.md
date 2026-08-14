# MCP

`@secondlayer/mcp` exposes the golden-path Secondlayer tools to MCP-capable
agents: Index reads, the subgraph lifecycle, subscriptions, contract
discovery/scaffolding, and key self-provisioning. Periphery surfaces (single
block/tx lookups, mempool, stacking, proofs, codegen, billing, projects, live
Streams reads, delivery forensics) are REST-only — see the `/v1` OpenAPI spec.

## Stdio Setup

```json
{
  "mcpServers": {
    "secondlayer": {
      "command": "bunx",
      "args": ["@secondlayer/mcp"],
      "env": {
        "SL_API_URL": "http://127.0.0.1:3800",
        "SL_API_KEY": "<INSTANCE_TOKEN>"
      }
    }
  }
}
```

Restart the MCP client after changing the config.

## HTTP Setup

```bash
export SL_API_URL=http://127.0.0.1:3800
export SL_API_KEY=<INSTANCE_TOKEN>
export SECONDLAYER_MCP_SECRET=local-bearer-secret
bunx --package @secondlayer/mcp mcp-http
```

Endpoint: `POST /mcp`, `GET /mcp`, `DELETE /mcp`.

Auth: `Authorization: Bearer <SECONDLAYER_MCP_SECRET>`.

## Tools

Index (decoded — loopback reads need no key; history is whatever this instance has bootstrapped):

- `index_events` — generic by event type; supports `trait` scoping
- `index_ft_transfers`
- `index_nft_transfers`
- `index_contract_calls`
- `index_blocks`
- `index_transactions`
- `index_discover` — the Index vocabulary (event types, filters); read before querying
- `batch_query` — up to 10 public `/v1` reads in one round trip

Subgraphs:

- `subgraphs_list`
- `subgraphs_get`
- `subgraphs_deploy` — accepts a `visibility` param (`public` | `private`; managed default public, BYO default private)
- `subgraphs_publish` / `subgraphs_unpublish` — flip visibility; publish claims the global public name (409 `PUBLIC_NAME_TAKEN`)
- `subgraphs_query`
- `subgraphs_backfill`
- `subgraphs_reindex`
- `subgraphs_stop`
- `subgraphs_gaps`
- `subgraphs_delete`

Subscriptions:

- `subscriptions_create` — creates either a subgraph subscription (`subgraphName` + `tableName`) or a **chain subscription** by passing `triggers` (array, 1..50) instead. Chain subs fire on raw chain events with no subgraph; see `references/sdk.md` for the trigger shapes (`contractCall`, `ftTransfer`, etc.).
- `subscriptions_list`
- `subscriptions_get`
- `subscriptions_update`
- `subscriptions_delete`
- `subscriptions_test`
- `subscriptions_replay`

Streams (loopback reads need no key):

- `streams_dumps` — bulk parquet dumps manifest (cold backfill path); live Streams reads are REST-only

Contracts / Scaffold:

- `contracts_find` — discover contracts conforming to a trait
- `get_contract_abi` — fetch one contract's metadata + full ABI
- `scaffold_from_contract` — generate a deploy-ready subgraph from a deployed contract

Account tools are unmounted on a local instance. Set `SL_API_KEY` to the `INSTANCE_TOKEN` from `secondlayer init` for writes.

Resources:

- `secondlayer://context` — live state: what exists, what you can do, read-auth tiers (read first)
- `secondlayer://filters`
- `secondlayer://column-types`
- `secondlayer://traits`
- `secondlayer://chain-triggers`

## Agent Rules

- Inspect before mutating.
- Human-confirm delete, reindex, and replay.
- Treat returned `signingSecret` and `key` values as one-time secrets.
- Use `index_discover` / `contracts_find` to learn the vocabulary before querying.
