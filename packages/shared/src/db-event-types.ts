import type { StreamsEventType } from "./event-types.ts";

// The physical event `type` labels as stored in the chain `events` table — the
// firehose vocab. Distinct from STREAMS_EVENT_TYPES (the decoded/public names in
// event-types.ts); these are the raw DB labels the indexer reads/counts.
/**
 * Version of the cursor ordinal contract. A Streams cursor is
 * `block_height:stream_event_index`, where the index is a dense ordinal over
 * every event of the block whose type is in `STREAMS_DB_EVENT_TYPES`. Adding,
 * removing or reordering a type shifts the ordinal of every later event in any
 * block that holds one, silently invalidating saved cursors. Change the list
 * only together with a bump of this number; `db-event-types.test.ts` pins both.
 *
 * `event_index` means one thing everywhere it is exposed: the event's 0-based
 * position within its block, counted in `(tx_index, event_index)` order of the
 * raw `events` rows. Streams, the decoded tables and subgraph event ids
 * (`${tx_id}#${event_index}`) all rely on it, so ids built from raw rows
 * (`PostgresBlockSource`) match ids built from the Index API
 * (`PublicApiBlockSource`) only while the raw column equals that position.
 * `findEventIndexMismatches` (db/queries/integrity.ts) checks it; the indexer
 * reports it on `/health/integrity` and `audit-event-index.ts` walks history.
 */
export const STREAMS_CURSOR_VERSION = 1;

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
