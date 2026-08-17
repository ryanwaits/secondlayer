# MCP

`@secondlayer/mcp` exposes the golden-path Secondlayer tools to MCP-capable
agents: Index reads, Streams reads, the subgraph lifecycle, subscriptions, and
contract discovery/scaffolding. Periphery surfaces (mempool, stacking, proofs)
are REST-only — see the `/v1` OpenAPI spec.

## Stdio Setup

```json
{
  "mcpServers": {
    "secondlayer": {
      "command": "bunx",
      "args": ["@secondlayer/mcp"],
      "env": {
        "SL_API_URL": "http://127.0.0.1:3800",
        "INSTANCE_TOKEN": "<from `secondlayer init`>"
      }
    }
  }
}
```

Restart the MCP client after changing the config.

## HTTP Setup

```bash
export SL_API_URL=http://127.0.0.1:3800
export INSTANCE_TOKEN=<from `secondlayer init`>
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
- `index_print_schema` — per-topic print payload schemas inferred from a contract's indexed history
- `codegen_index_schema` — an ORM schema for the Index tables, in-conversation
- `batch_query` — up to 10 `/v1` reads in one round trip

Subgraphs:

- `subgraphs_list`
- `subgraphs_status`
- `subgraphs_deploy` — open on any instance; no trial, quota, or visibility flag
- `subgraphs_scaffold` — generate a deploy-ready subgraph from a deployed contract
- `subgraphs_spec` — self-describing spec: `agent` JSON schema (default), `openapi`, or `markdown`
- `subgraphs_query`
- `subgraphs_backfill`
- `subgraphs_reindex`
- `subgraphs_stop`
- `subgraphs_operations` — operation history, or one by `operationId`; **the verify call** after deploy/reindex/backfill/stop
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
- `subscriptions_pause` / `subscriptions_resume` — stop/restart deliveries (resume also clears a tripped circuit); verify with `subscriptions_get`
- `subscriptions_rotate_secret` — new `signingSecret`, returned once; old signatures stop verifying immediately
- `subscriptions_deliveries` — recent attempts (status, error, duration); **the verify call** after create/test/replay
- `subscriptions_dead` — dead-letter queue (exhausted retries) with each row's `outboxId`
- `subscriptions_requeue` — retry one dead row by `outboxId`; fix the receiver first

Streams (raw — loopback reads need no key, same as Index):

- `streams_tip` — chain tip, finalized height, retention floor
- `streams_events` — one page of raw events; poll with `cursor` = prior `next_cursor` to follow the chain (no open-stream tool; SSE is REST-only). Always narrow — an unfiltered page is the firehose, and paging it is your Postgres doing the work
- `streams_events_by_tx` — every event from one transaction
- `streams_block_events` — every event in one block (height or hash)
- `streams_canonical` — canonical block at a height; confirm a consumed height wasn't reorged
- `streams_reorgs` — reorgs since a timestamp/token; resume with `next_since`
- `streams_dumps` — bulk parquet dumps manifest (cold backfill path)

Contracts:

- `contracts_find` — discover contracts conforming to a trait
- `contracts_get_abi` — fetch one contract's metadata + full ABI

Set `INSTANCE_TOKEN` (`SL_API_KEY` is the legacy alias) to the token `secondlayer init` wrote. It is required for every write, and for every read once the instance is reachable past loopback; Index, Streams, and subgraph reads on a loopback instance need none. Setting it always is safe — a token sent on a read that didn't need it is ignored, not rejected. There is no account tool surface: one instance, one token, no per-user keys to mint.

Resources:

- `secondlayer://context` — live state: this instance's subgraphs and subscriptions, what you can do, and which surfaces need the token (read first)
- `secondlayer://filters`
- `secondlayer://column-types`
- `secondlayer://traits`
- `secondlayer://chain-triggers`

## Agent Rules

- Inspect before mutating.
- Verify after mutating: `subgraphs_operations` for deploy/reindex/backfill/stop, `subscriptions_deliveries` for create/test/replay.
- Human-confirm delete, reindex, replay, and secret rotation.
- Treat returned `signingSecret` values as one-time secrets.
- Use `index_discover` / `contracts_find` to learn the vocabulary before querying.
