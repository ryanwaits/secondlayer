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
        "SL_API_KEY": "sk-sl_..."
      }
    }
  }
}
```

Restart the MCP client after changing the config.

## HTTP Setup

```bash
export SL_API_KEY=sk-sl_...
export SECONDLAYER_MCP_SECRET=local-bearer-secret
bunx --package @secondlayer/mcp mcp-http
```

Endpoint: `POST /mcp`, `GET /mcp`, `DELETE /mcp`.

Auth: `Authorization: Bearer <SECONDLAYER_MCP_SECRET>`.

## Tools

Index (decoded L2 — anonymous reads, or any key incl. free-tier; free/anon reads cover the recent 24h window, older history needs pay-as-you-go credits or a plan):

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

Streams (requires SL_API_KEY):

- `streams_dumps` — bulk parquet dumps manifest (cold backfill path); live Streams reads are REST-only

Contracts / Scaffold:

- `contracts_find` — discover contracts conforming to a trait
- `get_contract_abi` — fetch one contract's metadata + full ABI
- `scaffold_from_contract` — generate a deploy-ready subgraph from a deployed contract

Account:

- `account_whoami`
- `account_create_key` — mint a scoped `streams`/`index` read key; requires an account/owner key; returns the `sk-sl_…` key **once**

**Key products:** an `account` key (dashboard default, the `SL_API_KEY` you configure) grants both `streams:read` and `index:read` and is the only key that can mint; `streams`/`index` keys are scoped reads and cannot mint (403). Minted keys are always scoped and inherit your plan's tier.

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
