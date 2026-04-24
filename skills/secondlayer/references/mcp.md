# MCP

`@secondlayer/mcp` exposes Secondlayer account, subgraph, scaffold, and
subscription tools to MCP-capable agents.

## Stdio Setup

```json
{
  "mcpServers": {
    "secondlayer": {
      "command": "bunx",
      "args": ["@secondlayer/mcp"],
      "env": {
        "SL_SERVICE_KEY": "sk-sl_..."
      }
    }
  }
}
```

Restart the MCP client after changing the config.

## HTTP Setup

```bash
export SL_SERVICE_KEY=sk-sl_...
export SECONDLAYER_MCP_SECRET=local-bearer-secret
bunx --package @secondlayer/mcp mcp-http
```

Endpoint: `POST /mcp`, `GET /mcp`, `DELETE /mcp`.

Auth: `Authorization: Bearer <SECONDLAYER_MCP_SECRET>`.

## Tools

Subgraphs:

- `subgraphs_list`
- `subgraphs_get`
- `subgraphs_query`
- `subgraphs_deploy`
- `subgraphs_reindex`
- `subgraphs_delete`
- `subgraphs_read_source`

Subscriptions:

- `subscriptions_list`
- `subscriptions_get`
- `subscriptions_create`
- `subscriptions_update`
- `subscriptions_pause`
- `subscriptions_resume`
- `subscriptions_delete`
- `subscriptions_rotate_secret`
- `subscriptions_replay`
- `subscriptions_dead`
- `subscriptions_requeue_dead`
- `subscriptions_recent_deliveries`

Scaffold:

- `scaffold_from_contract`
- `scaffold_from_abi`

Account:

- `account_whoami`

Resources:

- `secondlayer://filters`
- `secondlayer://column-types`

## Agent Rules

- Inspect before mutating.
- Human-confirm delete, reindex, replay, requeue, and rotate-secret.
- Treat returned `signingSecret` values as one-time secrets.
- Use `subscriptions_recent_deliveries` and `subscriptions_dead` before replay.
- Use `subgraphs_read_source` before editing a deployed subgraph.
