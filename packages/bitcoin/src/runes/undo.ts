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

import { type RuneState, balanceKey, getBalance, setBalance } from "./state.ts";

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

export interface StateSnapshot {
	/** `balanceKey(outpoint, runeId)` -> amount, for every live balance. */
	balances: Map<string, bigint>;
	/** outpoint -> address, mirroring `state.balanceAddresses`. */
	addresses: Map<string, string>;
	/** ruleId -> `{mints, burned}`, for every rune entry that exists. */
	entries: Map<string, { mints: bigint; burned: bigint }>;
}

/**
 * A cheap, full copy of the parts of `state` a block can change — taken
 * immediately before applying a block, so `buildUndoPayload` can diff
 * "before" against `state` (mutated in place by the apply loop) immediately
 * after. Deliberately not scoped to "keys this block will touch" (unknowable
 * ahead of time without re-deriving the apply loop's own logic); a full
 * Map-of-primitives copy is cheap enough once per block in the only mode that
 * calls this (following the tip, one block at a time).
 */
export function snapshotState(state: RuneState): StateSnapshot {
	const balances = new Map<string, bigint>();
	for (const [outpoint, byRune] of state.balances) {
		for (const [runeId, amount] of byRune) {
			balances.set(balanceKey(outpoint, runeId), amount);
		}
	}
	const entries = new Map<string, { mints: bigint; burned: bigint }>();
	for (const [runeId, entry] of state.entries) {
		entries.set(runeId, { mints: entry.mints, burned: entry.burned });
	}
	return { balances, addresses: new Map(state.balanceAddresses), entries };
}

function splitBalanceKey(key: string): { outpoint: string; runeId: string } {
	const sep = key.lastIndexOf("|");
	return { outpoint: key.slice(0, sep), runeId: key.slice(sep + 1) };
}

/**
 * Diffs `before` (a `snapshotState` taken immediately before applying block
 * `height`) against `state` (immediately after) into that block's undo
 * payload. Pure — no DB. The digest chain proves `state` is correct after the
 * block; this only records how to get back to `before`.
 */
export function buildUndoPayload(
	height: number,
	before: StateSnapshot,
	state: RuneState,
): UndoPayload {
	const afterKeys = new Set<string>();
	for (const [outpoint, byRune] of state.balances) {
		for (const runeId of byRune.keys()) {
			afterKeys.add(balanceKey(outpoint, runeId));
		}
	}

	const allKeys = new Set<string>([...before.balances.keys(), ...afterKeys]);
	const balancesSpent: UndoBalanceRow[] = [];
	const balancesCreated: Array<{ outpoint: string; runeId: string }> = [];

	for (const key of allKeys) {
		const beforeAmount = before.balances.get(key);
		const { outpoint, runeId } = splitBalanceKey(key);
		const afterAmount = afterKeys.has(key)
			? getBalance(state, outpoint, runeId)
			: undefined;
		if (beforeAmount === afterAmount) continue; // untouched by this block

		if (beforeAmount !== undefined) {
			balancesSpent.push({
				outpoint,
				runeId,
				amount: beforeAmount,
				address: before.addresses.get(outpoint),
			});
		} else {
			balancesCreated.push({ outpoint, runeId });
		}
	}

	const entriesEtched: string[] = [];
	const entryDeltas: UndoEntryDelta[] = [];
	for (const [runeId, entry] of state.entries) {
		const beforeEntry = before.entries.get(runeId);
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
