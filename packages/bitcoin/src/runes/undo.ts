// Per-block undo journal (D10, `docs/internal/bitcoin-runtime.md`). Not a
// port of any ord file — ord never undoes a block (it re-indexes from
// scratch on a reorg it notices at all); this package needs to reverse
// exactly one block's effect on `RuneState` without a full rebuild, so a
// shallow reorg (≤ `UNDO_DEPTH` blocks) at the tip can be handled in place.
//
// Every function here is pure (no DB, no RPC) — `../db/store.ts`'s `flush`
// persists the payload this module builds (as `rune_undo`); `../rewind.ts`'s
// `rewindTo` mirrors `applyUndoPayload`'s reversal in SQL against the same
// payload, replayed from Postgres.

import {
	type RuneState,
	type UndoRecorder,
	getBalance,
	setBalance,
} from "./state.ts";

/** A per-block undo journal ≥ this deep (D10) — a reorg deeper than this halts ingest (fail closed) rather than raising it. */
export const UNDO_DEPTH = 12;

export interface UndoBalanceRow {
	outpoint: string;
	runeId: string;
	/** The balance's amount immediately before this block — what rewind restores it to. */
	amount: bigint;
	/** The outpoint's address (`../address.ts`) as of immediately before this block, if any. */
	address?: string;
}

export interface UndoEntryDelta {
	runeId: string;
	/** `entry.mints`/`entry.burned` immediately before this block — what rewind restores them to. */
	mints: bigint;
	burned: bigint;
}

/**
 * Everything needed to reverse one block's effect on `RuneState`. `height`
 * only labels the payload for storage/logging — every array here already
 * only contains this block's own touched keys (see `buildUndoPayload`).
 */
export interface UndoPayload {
	height: number;
	/** Balances that existed before this block and were touched by it — restored on rewind. */
	balancesSpent: UndoBalanceRow[];
	/** `(outpoint, runeId)` pairs with no balance before this block that do now — deleted on rewind. */
	balancesCreated: Array<{ outpoint: string; runeId: string }>;
	/** Rune IDs with no entry before this block (etched this block) — their entries are deleted entirely on rewind. */
	entriesEtched: string[];
	/** Pre-block `mints`/`burned` for every pre-existing rune this block touched — restored on rewind. */
	entryDeltas: UndoEntryDelta[];
}

function splitBalanceKey(key: string): { outpoint: string; runeId: string } {
	const sep = key.lastIndexOf("|");
	return { outpoint: key.slice(0, sep), runeId: key.slice(sep + 1) };
}

/**
 * Builds a block's undo payload from the pre-images `state.undoRecorder`
 * collected while the block was applied (`beginUndoCapture`), compared with
 * `state` immediately after. Only keys the block wrote are visited; a key it
 * wrote but left where it started (an outpoint created and spent inside one
 * block) is dropped, like an untouched one. Pure, no DB. The digest chain
 * proves `state` is correct after the block; this only records how to get back
 * to the state before it. Array order follows first touch, which carries no
 * meaning (rewind treats every array as a set).
 */
export function buildUndoPayload(
	height: number,
	recorder: UndoRecorder,
	state: RuneState,
): UndoPayload {
	const balancesSpent: UndoBalanceRow[] = [];
	const balancesCreated: Array<{ outpoint: string; runeId: string }> = [];

	for (const [key, beforeAmount] of recorder.balances) {
		const { outpoint, runeId } = splitBalanceKey(key);
		const held = getBalance(state, outpoint, runeId);
		const afterAmount = held === 0n ? undefined : held;
		if (beforeAmount === afterAmount) continue; // written but unchanged by this block

		if (beforeAmount !== undefined) {
			balancesSpent.push({
				outpoint,
				runeId,
				amount: beforeAmount,
				address: recorder.addresses.get(outpoint),
			});
		} else {
			balancesCreated.push({ outpoint, runeId });
		}
	}

	const entriesEtched: string[] = [];
	const entryDeltas: UndoEntryDelta[] = [];
	for (const [runeId, beforeEntry] of recorder.entries) {
		const entry = state.entries.get(runeId);
		if (entry === undefined) continue;
		if (beforeEntry === undefined) {
			entriesEtched.push(runeId);
		} else if (
			beforeEntry.mints !== entry.mints ||
			beforeEntry.burned !== entry.burned
		) {
			entryDeltas.push({
				runeId,
				mints: beforeEntry.mints,
				burned: beforeEntry.burned,
			});
		}
	}

	return { height, balancesSpent, balancesCreated, entriesEtched, entryDeltas };
}

/**
 * Reverses one block's payload against `state`, mutating it in place — the
 * exact inverse of the block `buildUndoPayload` was built from. Pure — no DB
 * (`../rewind.ts`'s `rewindTo` mirrors this in SQL for the persisted state).
 * Order matters: created pairs are cleared before spent ones are restored, in
 * case a key round-tripped (created, then separately re-touched) within the
 * same block — the two lists are otherwise disjoint by construction.
 */
export function applyUndoPayload(state: RuneState, payload: UndoPayload): void {
	for (const { outpoint, runeId } of payload.balancesCreated) {
		setBalance(state, outpoint, runeId, 0n);
	}
	for (const row of payload.balancesSpent) {
		setBalance(state, row.outpoint, row.runeId, row.amount, row.address);
	}
	for (const runeId of payload.entriesEtched) {
		const entry = state.entries.get(runeId);
		if (entry) state.runeToId.delete(entry.rune.toString());
		state.entries.delete(runeId);
		state.statisticRunes -= 1n;
	}
	for (const { runeId, mints, burned } of payload.entryDeltas) {
		const entry = state.entries.get(runeId);
		if (!entry) {
			throw new Error(
				`applyUndoPayload: no entry for rune ${runeId} at height ${payload.height}`,
			);
		}
		entry.mints = mints;
		entry.burned = burned;
	}
}

/** JSON-safe form of `UndoPayload` — bigints as decimal strings (JSON has no bigint), the shape stored in `rune_undo.payload`. */
export interface UndoPayloadJson {
	balancesSpent: Array<{
		outpoint: string;
		runeId: string;
		amount: string;
		address: string | null;
	}>;
	balancesCreated: Array<{ outpoint: string; runeId: string }>;
	entriesEtched: string[];
	entryDeltas: Array<{ runeId: string; mints: string; burned: string }>;
}

export function undoPayloadToJson(payload: UndoPayload): UndoPayloadJson {
	return {
		balancesSpent: payload.balancesSpent.map((row) => ({
			outpoint: row.outpoint,
			runeId: row.runeId,
			amount: row.amount.toString(),
			address: row.address ?? null,
		})),
		balancesCreated: payload.balancesCreated,
		entriesEtched: payload.entriesEtched,
		entryDeltas: payload.entryDeltas.map((d) => ({
			runeId: d.runeId,
			mints: d.mints.toString(),
			burned: d.burned.toString(),
		})),
	};
}

export function undoPayloadFromJson(
	height: number,
	json: UndoPayloadJson,
): UndoPayload {
	return {
		height,
		balancesSpent: json.balancesSpent.map((row) => ({
			outpoint: row.outpoint,
			runeId: row.runeId,
			amount: BigInt(row.amount),
			address: row.address ?? undefined,
		})),
		balancesCreated: json.balancesCreated,
		entriesEtched: json.entriesEtched,
		entryDeltas: json.entryDeltas.map((d) => ({
			runeId: d.runeId,
			mints: BigInt(d.mints),
			burned: BigInt(d.burned),
		})),
	};
}
