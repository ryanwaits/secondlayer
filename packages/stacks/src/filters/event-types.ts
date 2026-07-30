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

/** Every chain-event filter member across all four surfaces: the 10 decoded
 *  token/STX types, the three contract-shaped types (spelled as subgraphs and
 *  triggers spell them — Index/Streams project `print_event` → `print`), and
 *  the five sBTC lifecycle types (Subscriptions-only). */
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
	"sbtc_deposit",
	"sbtc_withdrawal_create",
	"sbtc_withdrawal_accept",
	"sbtc_withdrawal_reject",
	"sbtc_withdrawal_swept_confirmed",
] as const;

export type ChainEventFilterType = (typeof CHAIN_EVENT_FILTER_TYPES)[number];
