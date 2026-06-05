import type { StreamsEventType } from "./event-types.ts";

// The physical event `type` labels as stored in the chain `events` table — the
// firehose vocab. Distinct from STREAMS_EVENT_TYPES (the decoded/public names in
// event-types.ts); these are the raw DB labels the indexer reads/counts.
export const STREAMS_DB_EVENT_TYPES = [
	"stx_transfer_event",
	"stx_mint_event",
	"stx_burn_event",
	"stx_lock_event",
	"ft_transfer_event",
	"ft_mint_event",
	"ft_burn_event",
	"nft_transfer_event",
	"nft_mint_event",
	"nft_burn_event",
	// Print events have two DB labels: `smart_contract_event` (legacy, frozen
	// after the upstream node renamed) and `contract_event` (current). Both
	// carry identical payload shape — `topic`, `value`, `contract_identifier`.
	// Both must be queryable so consumers see prints across the rename
	// boundary (~block 7828030 on mainnet).
	"smart_contract_event",
	"contract_event",
] as const;

export type StreamsDbEventType = (typeof STREAMS_DB_EVENT_TYPES)[number];

export const DB_TO_STREAMS_EVENT_TYPE: Record<
	StreamsDbEventType,
	StreamsEventType
> = {
	stx_transfer_event: "stx_transfer",
	stx_mint_event: "stx_mint",
	stx_burn_event: "stx_burn",
	stx_lock_event: "stx_lock",
	ft_transfer_event: "ft_transfer",
	ft_mint_event: "ft_mint",
	ft_burn_event: "ft_burn",
	nft_transfer_event: "nft_transfer",
	nft_mint_event: "nft_mint",
	nft_burn_event: "nft_burn",
	smart_contract_event: "print",
	contract_event: "print",
};

// Each streams type maps to one or more DB type labels. Print maps to two
// (see comment on STREAMS_DB_EVENT_TYPES); all other types are 1:1.
export const STREAMS_TO_DB_EVENT_TYPES: Record<
	StreamsEventType,
	readonly StreamsDbEventType[]
> = {
	stx_transfer: ["stx_transfer_event"],
	stx_mint: ["stx_mint_event"],
	stx_burn: ["stx_burn_event"],
	stx_lock: ["stx_lock_event"],
	ft_transfer: ["ft_transfer_event"],
	ft_mint: ["ft_mint_event"],
	ft_burn: ["ft_burn_event"],
	nft_transfer: ["nft_transfer_event"],
	nft_mint: ["nft_mint_event"],
	nft_burn: ["nft_burn_event"],
	print: ["smart_contract_event", "contract_event"],
};
