// The decoded event-type vocabulary — canonical home. Index (decoded layer)
// and Streams (canonical firehose) expose the SAME set. This lives in
// @secondlayer/stacks because it is the leaf of the dependency graph
// (shared → stacks), so no package can drift a private copy upward:
// @secondlayer/shared re-exports it for back-compat.
export const DECODED_EVENT_TYPES = [
	"stx_transfer",
	"stx_mint",
	"stx_burn",
	"stx_lock",
	"ft_transfer",
	"ft_mint",
	"ft_burn",
	"nft_transfer",
	"nft_mint",
	"nft_burn",
	"print",
] as const;

export type DecodedEventType = (typeof DECODED_EVENT_TYPES)[number];

/** Opt-in node vm_events, stored names. Parallel to DECODED_EVENT_TYPES — not
 *  the decoded_events / Streams 1.0 vocab. Cursor second component is
 *  vm_event_index. Inner calls are never `contract_call`. */
export const VM_EVENT_TYPES = [
	"nested_contract_call",
	"var_set",
	"map_set",
	"map_insert",
	"map_delete",
] as const;

export type VmEventType = (typeof VM_EVENT_TYPES)[number];

/** Node `/new_block.vm_events[].type` → stored/Index/Streams name. One map,
 *  shared by the indexer parser and any consumer that reads raw observer
 *  bodies, so the two dialects cannot drift. Inner calls are never
 *  `contract_call` (that is the signed outer tx). */
export const VM_NODE_TO_STORED_TYPE = {
	contract_call_event: "nested_contract_call",
	var_set_event: "var_set",
	map_set_event: "map_set",
	map_insert_event: "map_insert",
	map_delete_event: "map_delete",
} as const satisfies Record<string, VmEventType>;

export type VmNodeEventType = keyof typeof VM_NODE_TO_STORED_TYPE;

/** Every chain-event filter member across all four surfaces: the 10 decoded
 *  token/STX types, the three contract-shaped types (spelled as subgraphs and
 *  triggers spell them — Index/Streams project `print_event` → `print`), and
 *  the five sBTC lifecycle types (Webhooks-only). */
export const CHAIN_EVENT_FILTER_TYPES = [
	"stx_transfer",
	"stx_mint",
	"stx_burn",
	"stx_lock",
	"ft_transfer",
	"ft_mint",
	"ft_burn",
	"nft_transfer",
	"nft_mint",
	"nft_burn",
	"contract_call",
	"contract_deploy",
	"print_event",
	"nested_contract_call",
	"var_set",
	"map_set",
	"map_insert",
	"map_delete",
	"sbtc_deposit",
	"sbtc_withdrawal_create",
	"sbtc_withdrawal_accept",
	"sbtc_withdrawal_reject",
	"sbtc_withdrawal_swept_confirmed",
] as const;

export type ChainEventFilterType = (typeof CHAIN_EVENT_FILTER_TYPES)[number];
