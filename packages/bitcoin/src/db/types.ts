import type { Generated } from "kysely";

// Kysely table types for this package's own Postgres (D18: separate from
// `packages/shared`'s `Database` type). Numeric columns are typed `string`
// because `postgres.js` returns `numeric` as a string — convert with
// `BigInt(...)` on read, `.toString()` on write. Never go through `Number`
// for a u128 value (plan rule).

export interface RuneEntriesTable {
	rune_id: string;
	block: string;
	tx: string;
	number: string;
	rune: string;
	spaced_rune: string;
	spacers: number;
	divisibility: number;
	symbol: string | null;
	premine: string;
	terms_amount: string | null;
	terms_cap: string | null;
	terms_height_start: string | null;
	terms_height_end: string | null;
	terms_offset_start: string | null;
	terms_offset_end: string | null;
	turbo: boolean;
	etching_txid: string;
	timestamp: string;
	mints: string;
	burned: string;
}

export interface RuneBalancesTable {
	txid: string;
	vout: number;
	rune_id: string;
	amount: string;
}

export interface RuneEventsTable {
	id: Generated<string>;
	height: number;
	tx_index: number;
	txid: string;
	kind: "etch" | "mint" | "transfer" | "burn";
	rune_id: string;
	amount: string;
	vout: number | null;
}

export interface BtcBlocksTable {
	height: number;
	hash: string;
}

export interface RunesCheckpointTable {
	name: string;
	height: number;
	hash: string;
	updated_at: Date;
}

export interface RuneBlockDigestsTable {
	height: number;
	block_hash: string;
	digest: string;
	event_count: number;
}

export interface Database {
	rune_entries: RuneEntriesTable;
	rune_balances: RuneBalancesTable;
	rune_events: RuneEventsTable;
	btc_blocks: BtcBlocksTable;
	runes_checkpoint: RunesCheckpointTable;
	rune_block_digests: RuneBlockDigestsTable;
}

export const CHECKPOINT_NAME = "runes";
