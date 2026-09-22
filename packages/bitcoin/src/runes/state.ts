// In-memory Runes state, updated by updater.ts and flushed by ../db/store.ts.
// Not a direct port of any single ord file — ord keeps this in redb tables
// (`src/index.rs`'s table definitions); this is the equivalent in-memory shape
// for the spike, keyed the same way (`RuneId` as `block:tx`, `OutPoint` as
// `txid:vout`) so the DB schema (migrations/0001_runes.ts) maps onto it 1:1.

import type { RuneEntry } from "./entry.ts";
import { SUBSIDY_HALVING_INTERVAL, rune } from "./rune.ts";
import type { RuneId } from "./rune_id.ts";
import { runeIdToString } from "./rune_id.ts";

export type RuneEvent =
	| {
			kind: "etch";
			height: number;
			txIndex: number;
			txid: string;
			ruleId: string;
	  }
	| {
			kind: "mint";
			height: number;
			txIndex: number;
			txid: string;
			ruleId: string;
			amount: bigint;
	  }
	| {
			kind: "transfer";
			height: number;
			txIndex: number;
			txid: string;
			ruleId: string;
			amount: bigint;
			vout: number;
	  }
	| {
			kind: "burn";
			height: number;
			txIndex: number;
			txid: string;
			ruleId: string;
			amount: bigint;
	  };

export interface RuneState {
	/** Keyed by `RuneId` as `"block:tx"`. */
	entries: Map<string, RuneEntry>;
	/** Outer key: outpoint `"txid:vout"`. Inner key: `RuneId` as `"block:tx"`. */
	balances: Map<string, Map<string, bigint>>;
	/**
	 * Secondary index of `balances`, inverted: `RuneId` string -> outpoint ->
	 * amount. Not in ord (its `outpoint_to_balances` table is the only balance
	 * index; ord never needs "every outpoint holding rune X" as a query). Kept
	 * here so the supply invariant (../runes/invariant.ts) can sum a dirty
	 * rune's live balance without scanning every outpoint in the state on
	 * every 1,000-block flush.
	 */
	balancesByRune: Map<string, Map<string, bigint>>;
	/** `Rune.n` (decimal string, since bigint isn't a valid Map key across JSON) -> RuneId string. Mirrors ord's `rune_to_id` table; used to reject re-etching. */
	runeToId: Map<string, string>;
	statisticRunes: bigint;
	statisticReservedRunes: bigint;
	/** Dirty rune IDs since the last flush — upserted and invariant-checked at flush time. */
	dirtyRuneIds: Set<string>;
	/** Outpoints spent since the last flush — deleted from `rune_balances` at flush time. */
	dirtySpentOutpoints: Set<string>;
	/** Outpoints with a new/changed balance since the last flush — upserted at flush time. */
	dirtyOutpoints: Set<string>;
	events: RuneEvent[];
	height?: number;
	hash?: string;
}

export function createRuneState(): RuneState {
	return {
		entries: new Map(),
		balances: new Map(),
		balancesByRune: new Map(),
		runeToId: new Map(),
		statisticRunes: 0n,
		statisticReservedRunes: 0n,
		dirtyRuneIds: new Set(),
		dirtySpentOutpoints: new Set(),
		dirtyOutpoints: new Set(),
		events: [],
	};
}

export function getBalance(
	state: RuneState,
	outpoint: string,
	ruleId: string,
): bigint {
	return state.balances.get(outpoint)?.get(ruleId) ?? 0n;
}

/** Sets a balance (0 deletes it), keeping `balances`/`balancesByRune` and the dirty sets in sync. */
export function setBalance(
	state: RuneState,
	outpoint: string,
	ruleId: string,
	amount: bigint,
): void {
	let byOutpoint = state.balances.get(outpoint);
	let byRune = state.balancesByRune.get(ruleId);

	if (amount === 0n) {
		byOutpoint?.delete(ruleId);
		if (byOutpoint?.size === 0) state.balances.delete(outpoint);
		byRune?.delete(outpoint);
		if (byRune?.size === 0) state.balancesByRune.delete(ruleId);
	} else {
		if (!byOutpoint) {
			byOutpoint = new Map();
			state.balances.set(outpoint, byOutpoint);
		}
		byOutpoint.set(ruleId, amount);

		if (!byRune) {
			byRune = new Map();
			state.balancesByRune.set(ruleId, byRune);
		}
		byRune.set(outpoint, amount);
	}

	state.dirtyOutpoints.add(outpoint);
	state.dirtyRuneIds.add(ruleId);
}

/** Removes every rune balance held at `outpoint` (spending it), returning what it held. */
export function takeOutpointBalances(
	state: RuneState,
	outpoint: string,
): Map<string, bigint> {
	const held = state.balances.get(outpoint);
	if (!held || held.size === 0) return new Map();

	const snapshot = new Map(held);
	for (const ruleId of snapshot.keys()) {
		setBalance(state, outpoint, ruleId, 0n);
	}
	state.dirtySpentOutpoints.add(outpoint);
	return snapshot;
}

/** Sum of every live balance of `ruleId` across all outpoints — the invariant's `sum(balances)` term. */
export function sumRuneBalance(state: RuneState, ruleId: string): bigint {
	let total = 0n;
	for (const amount of state.balancesByRune.get(ruleId)?.values() ?? []) {
		total += amount;
	}
	return total;
}

const U128_MAX = (1n << 128n) - 1n;

/**
 * `src/index.rs` (~line 381): the pre-existing rune UNCOMMON•GOODS,
 * `Rune(2055900680524219742)`, id `1:0`, inserted once at index creation
 * (mainnet only) so its first real-chain mint (unlocks at height 840,000,
 * the terms' height-start) doesn't need an on-chain etching transaction.
 * Every field below is copied verbatim from that seed, including `spacers:
 * 128` and `turbo: true` — both easy to get wrong since they don't follow
 * from the rune's name the way a normal etching's would.
 */
export const UNCOMMON_GOODS_RUNE_ID: RuneId = { block: 1n, tx: 0n };
export const UNCOMMON_GOODS_RUNE = rune(2055900680524219742n);

export function seedGenesis(state: RuneState): void {
	const idKey = runeIdToString(UNCOMMON_GOODS_RUNE_ID);
	const entry: RuneEntry = {
		block: UNCOMMON_GOODS_RUNE_ID.block,
		burned: 0n,
		divisibility: 0,
		etching: "0".repeat(64),
		mints: 0n,
		number: 0n,
		premine: 0n,
		rune: UNCOMMON_GOODS_RUNE.n,
		spacers: 128,
		symbol: "⧉",
		terms: {
			amount: 1n,
			cap: U128_MAX,
			height: [
				BigInt(SUBSIDY_HALVING_INTERVAL * 4),
				BigInt(SUBSIDY_HALVING_INTERVAL * 5),
			],
			offset: [undefined, undefined],
		},
		timestamp: 0n,
		turbo: true,
	};
	state.entries.set(idKey, entry);
	state.runeToId.set(UNCOMMON_GOODS_RUNE.n.toString(), idKey);
	state.statisticRunes = 1n;
}
