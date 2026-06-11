---
"@secondlayer/mcp": major
---

Prune the MCP tool surface to the golden path (32 tools). The MCP server is a distribution channel for agents, not a parity mirror — periphery surfaces stay available via REST `/v1` + OpenAPI.

Removed tool groups:

- Streams live reads: `streams_tip`, `streams_events`, `streams_consume`, `streams_event_by_txid`, `streams_block_events`, `streams_reorgs`, `streams_canonical`, `streams_usage` (only `streams_dumps` remains); the `secondlayer://streams-filters` resource went with them
- Index periphery: `index_canonical`, `index_block`, `index_transaction`, `index_transaction_proof`, `index_stacking`, `index_mempool`, `index_mempool_tx`, `index_usage`, `index_codegen`
- Subgraphs periphery: `subgraphs_spec`, `subgraphs_aggregate`, `subgraphs_operation`, `subgraphs_read_source`, `subgraphs_codegen`
- Subscriptions periphery: `subscriptions_pause`, `subscriptions_resume`, `subscriptions_rotate_secret`, `subscriptions_dead`, `subscriptions_requeue_dead`, `subscriptions_recent_deliveries`
- Account periphery: `account_update`, `account_billing`, `account_usage`, `account_get_caps`, `account_set_caps`, `account_list_keys`, `account_revoke_key`
- Projects: all `project_*` tools
- Contracts/scaffold periphery: `generate_contract_interface`, `scaffold_from_trait`, `scaffold_from_abi`

Kept: Index reads (`index_events`/`index_ft_transfers`/`index_nft_transfers`/`index_contract_calls`/`index_blocks`/`index_transactions`/`index_discover`/`batch_query`), the subgraphs lifecycle (list/get/deploy/publish/unpublish/delete/query/backfill/reindex/stop/gaps), subscriptions (create/list/get/update/delete/test/replay), `streams_dumps`, `contracts_find`/`get_contract_abi`/`scaffold_from_contract`, and `account_whoami`/`account_create_key`. Capabilities in `secondlayer://context` remain generated from the live tool registry; a drift test now locks the exact golden-path tool set. x402 auto-pay wiring is unchanged.
