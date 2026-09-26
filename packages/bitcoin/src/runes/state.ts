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
			runeId: string;
	  }
	| {
			kind: "mint";
			height: number;
			txIndex: number;
			txid: string;
			runeId: string;
			amount: bigint;
	  }
	| {
			kind: "transfer";
			height: number;
			txIndex: number;
			txid: string;
			runeId: string;
			amount: bigint;
			vout: number;
			/**
			 * The output's mainnet address (`../address.ts`), when its scriptPubKey
			 * is one of the five standard types — `undefined` otherwise. Derived,
			 * not part of the digest chain (plan 057: kept out of
			 * `../integrity/digest.ts`'s `serializeEvent`).
			 */
			address?: string;
	  }
	| {
			kind: "burn";
			height: number;
			txIndex: number;
			txid: string;
			runeId: string;
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
	/**
	 * `(outpoint, runeId)` pairs touched since the last flush, as
	 * `"${outpoint}|${runeId}"`. This is every pair the flush needs to
	 * *consider*, not every pair it needs to write — see `dbBalanceKeys`,
	 * whose comparison against this set is what lets the flush skip a pair
	 * that was created and fully spent within the same window (never
	 * persisted, so it needs neither an insert nor a delete). Without that
	 * comparison, a dense window (e.g. the Runes launch block) turns into one
	 * DB round trip per touched pair — the flush performance defect this
	 * field exists to fix (see db/store.ts's `computeBalanceChanges`).
	 */
	dirtyBalanceKeys: Set<string>;
	/**
	 * `(outpoint, runeId)` pairs the flush believes are CURRENTLY persisted in
	 * `rune_balances` — loaded once in `loadState` and kept in sync after
	 * every successful flush. Not ord's concept (ord's redb table has no such
	 * shadow); it exists purely so `computeBalanceChanges` can tell "existed
	 * before, now empty -> delete" apart from "never existed -> no-op".
	 */
	dbBalanceKeys: Set<string>;
	/**
	 * Outpoint (`"txid:vout"`) -> its mainnet address, for every outpoint that
	 * currently holds a live rune balance. One address per outpoint (an
	 * output's scriptPubKey doesn't vary by rune), set by `setBalance` from the
	 * output script, cleared when the outpoint's last balance is spent. Not ord
	 * (`../address.ts`'s docstring): only rune-bearing outputs get an entry.
	 */
	balanceAddresses: Map<string, string>;
	events: RuneEvent[];
	height?: number;
	hash?: string;
	/** The block digest chain's running value (`d_height`, see ../integrity/digest.ts), `GENESIS_DIGEST` when `height` is undefined. */
	digest?: Uint8Array;
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
		dirtyBalanceKeys: new Set(),
		dbBalanceKeys: new Set(),
		balanceAddresses: new Map(),
		events: [],
	};
}

/** `"${outpoint}|${runeId}"` — the composite key used by `dirtyBalanceKeys`/`dbBalanceKeys`. Neither half can contain `|` (txid is hex, vout/runeId are digits and `:`). */
export function balanceKey(outpoint: string, runeId: string): string {
	return `${outpoint}|${runeId}`;
}

export function getBalance(
	state: RuneState,
	outpoint: string,
	runeId: string,
): bigint {
	return state.balances.get(outpoint)?.get(runeId) ?? 0n;
}

/**
 * Sets a balance (0 deletes it), keeping `balances`/`balancesByRune` and the
 * dirty sets in sync. `address` (the outpoint's derived mainnet address, see
 * `../address.ts`) is recorded in `balanceAddresses` the first time this
 * outpoint gets a live balance, and cleared once its last balance is spent —
 * an outpoint's address never varies by rune, so a caller setting a second
 * rune on an already-tracked outpoint can omit it.
 */
export function setBalance(
	state: RuneState,
	outpoint: string,
	runeId: string,
	amount: bigint,
	address?: string,
): void {
	let byOutpoint = state.balances.get(outpoint);
	let byRune = state.balancesByRune.get(runeId);

	if (amount === 0n) {
		byOutpoint?.delete(runeId);
		if (byOutpoint?.size === 0) {
			state.balances.delete(outpoint);
			state.balanceAddresses.delete(outpoint);
		}
		byRune?.delete(outpoint);
		if (byRune?.size === 0) state.balancesByRune.delete(runeId);
	} else {
		if (!byOutpoint) {
			byOutpoint = new Map();
			state.balances.set(outpoint, byOutpoint);
		}
		byOutpoint.set(runeId, amount);

		if (!byRune) {
			byRune = new Map();
			state.balancesByRune.set(runeId, byRune);
		}
		byRune.set(outpoint, amount);

		if (address !== undefined) state.balanceAddresses.set(outpoint, address);
	}

	state.dirtyBalanceKeys.add(balanceKey(outpoint, runeId));
	state.dirtyRuneIds.add(runeId);
}

/** Removes every rune balance held at `outpoint` (spending it), returning what it held. */
export function takeOutpointBalances(
	state: RuneState,
	outpoint: string,
): Map<string, bigint> {
	const held = state.balances.get(outpoint);
	if (!held || held.size === 0) return new Map();

	const snapshot = new Map(held);
	for (const runeId of snapshot.keys()) {
		setBalance(state, outpoint, runeId, 0n);
	}
	return snapshot;
}

/** Sum of every live balance of `runeId` across all outpoints — the invariant's `sum(balances)` term. */
export function sumRuneBalance(state: RuneState, runeId: string): bigint {
	let total = 0n;
	for (const amount of state.balancesByRune.get(runeId)?.values() ?? []) {
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
