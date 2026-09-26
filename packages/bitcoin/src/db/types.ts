import type { Generated } from "kysely";
import type { UndoPayloadJson } from "../runes/undo.ts";

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
	/** Raw Unicode scalar of the etched symbol (survives U+0000, unlike `symbol`); source of truth for `loadState`/parity, see migration 0003. */
	symbol_codepoint: number | null;
	premine: string;
	terms_amount: string | null;
	terms_cap: string | null;
	terms_height_start: string | null;
	terms_height_end: string | null;
	terms_offset_start: string | null;
	terms_offset_end: string | null;
	/** Whether `RuneEntry.terms` was ever set, even with every field unset (survives that case, unlike the `terms_*` null-check); source of truth for `loadState`/parity, see migration 0003. */
	has_terms: boolean;
	turbo: boolean;
	etching_txid: string;
	timestamp: string;
	mints: string;
	burned: string;
	/** Set by `cli.ts repair-entries` once a row's `symbol_codepoint`/`has_terms` are known correct; not read by `loadState`. */
	repaired_at: Date | null;
}

export interface RuneBalancesTable {
	txid: string;
	vout: number;
	rune_id: string;
	amount: string;
	/** Mainnet address derived from the outpoint's scriptPubKey (`../address.ts`), null for a non-standard script. Migration 0004. */
	address: string | null;
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
	/** This event's position within its block, in the digest chain's canonical order (migration 0004). */
	event_index: number;
	/** Mainnet address derived from the output's scriptPubKey (`../address.ts`); only ever set on a `transfer` event. Migration 0004. */
	address: string | null;
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

/** D10 per-block undo journal, kept ≥ `UNDO_DEPTH` (`../runes/undo.ts`) blocks deep while following the tip. */
export interface RuneUndoTable {
	height: number;
	block_hash: string;
	payload: UndoPayloadJson;
}

/** Same fields as the Stacks `ChainReorgRecord` (`packages/shared/src/db/queries/chain-reorgs.ts`), so plan 059 can serve this table as `reorgs`. */
export interface BtcReorgsTable {
	id: Generated<string>;
	detected_at: Generated<Date>;
	fork_point_height: number;
	old_hash: string;
	new_hash: string;
	orphaned_from: number;
	orphaned_to: number;
	new_tip_height: number;
}

export interface Database {
	rune_entries: RuneEntriesTable;
	rune_balances: RuneBalancesTable;
	rune_events: RuneEventsTable;
	btc_blocks: BtcBlocksTable;
	runes_checkpoint: RunesCheckpointTable;
	rune_block_digests: RuneBlockDigestsTable;
	rune_undo: RuneUndoTable;
	btc_reorgs: BtcReorgsTable;
}

export const CHECKPOINT_NAME = "runes";
