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

/**
 * One outpoint's live rune balances. Almost every outpoint holds a single
 * rune, so that case is a bare `[runeId, amount]` tuple; only an outpoint
 * holding two or more runes pays for a `Map` (runeId -> amount). At 7M
 * outpoints the per-outpoint `Map` this replaces was the largest structure in
 * memory.
 */
export type OutpointBalances =
	| [runeId: string, amount: bigint]
	| Map<string, bigint>;

export interface RuneState {
	/** Keyed by `RuneId` as `"block:tx"`. */
	entries: Map<string, RuneEntry>;
	/** Outpoint `"txid:vout"` -> the runes it holds. See `OutpointBalances`; read and write through the helpers below, never by shape. */
	balances: Map<string, OutpointBalances>;
	/**
	 * `RuneId` string -> the sum of that rune's live balances across every
	 * outpoint, kept as a running total by `setBalance` (and seeded by
	 * `seedBalance` at load). Not in ord. It lets the supply invariant
	 * (../runes/invariant.ts) read a dirty rune's circulating supply in O(1)
	 * without scanning every outpoint. A rune with no live balance has no
	 * entry.
	 */
	liveSupply: Map<string, bigint>;
	/** `Rune.n` (decimal string, since bigint isn't a valid Map key across JSON) -> RuneId string. Mirrors ord's `rune_to_id` table; used to reject re-etching. */
	runeToId: Map<string, string>;
	statisticRunes: bigint;
	statisticReservedRunes: bigint;
	/** Dirty rune IDs since the last flush — upserted and invariant-checked at flush time. */
	dirtyRuneIds: Set<string>;
	/**
	 * `(outpoint, runeId)` pairs touched since the last flush, as
	 * `"${outpoint}|${runeId}"`. The flush writes every one of them: a pair
	 * with a live amount is upserted, a pair at zero is deleted (a delete of a
	 * row that was never persisted is a no-op, which is how a pair created and
	 * spent inside one window never reaches the table).
	 */
	dirtyBalanceKeys: Set<string>;
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
		liveSupply: new Map(),
		runeToId: new Map(),
		statisticRunes: 0n,
		statisticReservedRunes: 0n,
		dirtyRuneIds: new Set(),
		dirtyBalanceKeys: new Set(),
		balanceAddresses: new Map(),
		events: [],
	};
}

/** `"${outpoint}|${runeId}"` — the composite key used by `dirtyBalanceKeys`. Neither half can contain `|` (txid is hex, vout/runeId are digits and `:`). */
export function balanceKey(outpoint: string, runeId: string): string {
	return `${outpoint}|${runeId}`;
}

function amountHeld(
	held: OutpointBalances | undefined,
	runeId: string,
): bigint {
	if (held === undefined) return 0n;
	if (Array.isArray(held)) return held[0] === runeId ? held[1] : 0n;
	return held.get(runeId) ?? 0n;
}

export function getBalance(
	state: RuneState,
	outpoint: string,
	runeId: string,
): bigint {
	return amountHeld(state.balances.get(outpoint), runeId);
}

/** Adds `delta` to `runeId`'s running live supply, dropping the entry when it reaches zero. */
function adjustLiveSupply(
	state: RuneState,
	runeId: string,
	delta: bigint,
): void {
	if (delta === 0n) return;
	const next = (state.liveSupply.get(runeId) ?? 0n) + delta;
	if (next === 0n) state.liveSupply.delete(runeId);
	else state.liveSupply.set(runeId, next);
}

/**
 * Writes `amount` for `runeId` at `outpoint` into `state.balances` (0
 * deletes it), promoting a single-rune tuple to a Map when a second rune
 * arrives and demoting it back when only one is left; an emptied outpoint
 * also loses its address. Returns the amount it replaced. Insertion order of
 * a multi-rune outpoint is preserved (`takeOutpointBalances` hands it to the
 * updater in that order).
 */
function writeBalance(
	state: RuneState,
	outpoint: string,
	runeId: string,
	amount: bigint,
): bigint {
	const held = state.balances.get(outpoint);
	const previous = amountHeld(held, runeId);

	if (amount === 0n) {
		if (held === undefined || previous === 0n) return 0n;
		if (Array.isArray(held)) {
			state.balances.delete(outpoint);
			state.balanceAddresses.delete(outpoint);
			return previous;
		}
		held.delete(runeId);
		if (held.size === 1) {
			const [remainingRune, remainingAmount] = held.entries().next().value as [
				string,
				bigint,
			];
			state.balances.set(outpoint, [remainingRune, remainingAmount]);
		} else if (held.size === 0) {
			state.balances.delete(outpoint);
			state.balanceAddresses.delete(outpoint);
		}
		return previous;
	}

	if (held === undefined) {
		state.balances.set(outpoint, [runeId, amount]);
	} else if (Array.isArray(held)) {
		if (held[0] === runeId) {
			held[1] = amount;
		} else {
			state.balances.set(
				outpoint,
				new Map([
					[held[0], held[1]],
					[runeId, amount],
				]),
			);
		}
	} else {
		held.set(runeId, amount);
	}
	return previous;
}

/**
 * Sets a balance (0 deletes it), keeping `balances`, `liveSupply` and the
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
	const previous = writeBalance(state, outpoint, runeId, amount);
	adjustLiveSupply(state, runeId, amount - previous);
	if (amount !== 0n && address !== undefined) {
		state.balanceAddresses.set(outpoint, address);
	}

	state.dirtyBalanceKeys.add(balanceKey(outpoint, runeId));
	state.dirtyRuneIds.add(runeId);
}

/**
 * Loads one persisted balance row into `state` (`loadState`'s only writer):
 * like `setBalance` with a live amount, but marks nothing dirty because the
 * row is already in Postgres.
 */
export function seedBalance(
	state: RuneState,
	outpoint: string,
	runeId: string,
	amount: bigint,
	address: string | null,
): void {
	const previous = writeBalance(state, outpoint, runeId, amount);
	adjustLiveSupply(state, runeId, amount - previous);
	if (address !== null) state.balanceAddresses.set(outpoint, address);
}

/** Removes every rune balance held at `outpoint` (spending it), returning what it held. */
export function takeOutpointBalances(
	state: RuneState,
	outpoint: string,
): Map<string, bigint> {
	const held = state.balances.get(outpoint);
	if (held === undefined) return new Map();

	const snapshot = Array.isArray(held) ? new Map([held]) : new Map(held);
	for (const runeId of snapshot.keys()) {
		setBalance(state, outpoint, runeId, 0n);
	}
	return snapshot;
}

/** Every live `(outpoint, runeId, amount)` in `state.balances`, in insertion order. */
export function* iterateBalances(
	state: RuneState,
): Generator<[outpoint: string, runeId: string, amount: bigint]> {
	for (const [outpoint, held] of state.balances) {
		if (Array.isArray(held)) {
			yield [outpoint, held[0], held[1]];
		} else {
			for (const [runeId, amount] of held) yield [outpoint, runeId, amount];
		}
	}
}

/** Sum of every live balance of `runeId` across all outpoints — the invariant's `sum(balances)` term. */
export function sumRuneBalance(state: RuneState, runeId: string): bigint {
	return state.liveSupply.get(runeId) ?? 0n;
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
