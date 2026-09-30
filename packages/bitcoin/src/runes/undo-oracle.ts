// TEST ORACLE ONLY, never imported by runtime code. The original undo-payload
// path: a full copy of the state before a block, diffed against the state
// after it. `undo.ts`'s `buildUndoPayload` replaced it on the hot path with
// per-block pre-image recording; the tests compare the two on the same blocks.

import {
	type RuneState,
	balanceKey,
	getBalance,
	iterateBalances,
} from "./state.ts";
import type { UndoBalanceRow, UndoEntryDelta, UndoPayload } from "./undo.ts";

export interface StateSnapshot {
	/** `balanceKey(outpoint, runeId)` -> amount, for every live balance. */
	balances: Map<string, bigint>;
	/** outpoint -> address, mirroring `state.balanceAddresses`. */
	addresses: Map<string, string>;
	/** runeId -> `{mints, burned}`, for every rune entry that exists. */
	entries: Map<string, { mints: bigint; burned: bigint }>;
}

/** A full copy of the parts of `state` a block can change. */
export function snapshotState(state: RuneState): StateSnapshot {
	const balances = new Map<string, bigint>();
	for (const [outpoint, runeId, amount] of iterateBalances(state)) {
		balances.set(balanceKey(outpoint, runeId), amount);
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

/** Diffs `before` (a `snapshotState` taken immediately before block `height`) against `state` immediately after. */
export function buildUndoPayloadFromSnapshot(
	height: number,
	before: StateSnapshot,
	state: RuneState,
): UndoPayload {
	const afterKeys = new Set<string>();
	for (const [outpoint, runeId] of iterateBalances(state)) {
		afterKeys.add(balanceKey(outpoint, runeId));
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
