// Pure-function tests for the flush batching logic (no Postgres needed).
// Added after a reviewer-caught defect: the original flush() issued one
// DELETE+INSERT round trip per touched outpoint, which measured as
// single-row statements sitting in pg_stat_activity for 45+ minutes on the
// Runes launch window. `computeBalanceChanges` is the fix's core: it decides,
// from in-memory state alone, exactly which rows need a write.
import { describe, expect, test } from "bun:test";
import type { RuneEntry } from "../runes/entry.ts";
import { createRuneState, setBalance } from "../runes/state.ts";
import {
	DELETE_CHUNK_SIZE,
	ENTRY_CHUNK_SIZE,
	EVENT_CHUNK_SIZE,
	POSTGRES_MAX_PARAMETERS,
	RUNE_BALANCES_PARAMS_PER_ROW,
	RUNE_ENTRIES_PARAMS_PER_ROW,
	RUNE_EVENTS_PARAMS_PER_ROW,
	UPSERT_CHUNK_SIZE,
	computeBalanceChanges,
	entryToRow,
	rowToEntry,
	symbolForDb,
} from "./store.ts";

const U128_MAX = (1n << 128n) - 1n;

describe("computeBalanceChanges", () => {
	test("a balance created and fully spent within one flush window touches neither list", () => {
		const state = createRuneState();
		const outpoint = `${"a".repeat(64)}:0`;
		const runeId = "840000:1";

		// Created this window...
		setBalance(state, outpoint, runeId, 500n);
		// ...then fully spent, still within the same window (never flushed in between).
		setBalance(state, outpoint, runeId, 0n);

		const { toUpsert, toDelete } = computeBalanceChanges(state);

		expect(toUpsert).toHaveLength(0);
		expect(toDelete).toHaveLength(0);
	});

	test("a balance that existed before this flush and is now fully spent is queued for delete", () => {
		const state = createRuneState();
		const outpoint = `${"b".repeat(64)}:1`;
		const runeId = "840000:2";

		// Simulate a prior flush having persisted this row.
		setBalance(state, outpoint, runeId, 100n);
		state.dbBalanceKeys.add(`${outpoint}|${runeId}`);
		state.dirtyBalanceKeys.clear(); // the prior flush would have cleared this

		// This window: spend it.
		setBalance(state, outpoint, runeId, 0n);

		const { toUpsert, toDelete } = computeBalanceChanges(state);

		expect(toUpsert).toHaveLength(0);
		expect(toDelete).toEqual([{ txid: "b".repeat(64), vout: 1, runeId }]);
	});

	test("a new nonzero balance is queued for upsert with the exact amount", () => {
		const state = createRuneState();
		const outpoint = `${"c".repeat(64)}:2`;
		const runeId = "840000:3";

		setBalance(state, outpoint, runeId, 42n);

		const { toUpsert, toDelete } = computeBalanceChanges(state);

		expect(toDelete).toHaveLength(0);
		expect(toUpsert).toEqual([
			{ txid: "c".repeat(64), vout: 2, runeId, amount: 42n },
		]);
	});

	test("preserves a near-u128-max amount exactly (no Number conversion)", () => {
		const state = createRuneState();
		const outpoint = `${"d".repeat(64)}:3`;
		const runeId = "840000:4";
		const hugeAmount = U128_MAX - 1n; // 340282366920938463463374607431768211454

		setBalance(state, outpoint, runeId, hugeAmount);

		const { toUpsert } = computeBalanceChanges(state);

		expect(toUpsert).toHaveLength(1);
		expect(toUpsert[0]?.amount).toBe(hugeAmount);
		// The exact string that would be bound as the ::numeric parameter.
		expect(toUpsert[0]?.amount.toString()).toBe(
			"340282366920938463463374607431768211454",
		);
	});

	test("an existing balance whose amount changed within the window is upserted, not deleted", () => {
		const state = createRuneState();
		const outpoint = `${"e".repeat(64)}:4`;
		const runeId = "840000:5";

		setBalance(state, outpoint, runeId, 10n);
		state.dbBalanceKeys.add(`${outpoint}|${runeId}`);
		state.dirtyBalanceKeys.clear();

		setBalance(state, outpoint, runeId, 7n); // partial spend within this window

		const { toUpsert, toDelete } = computeBalanceChanges(state);

		expect(toDelete).toHaveLength(0);
		expect(toUpsert).toEqual([
			{ txid: "e".repeat(64), vout: 4, runeId, amount: 7n },
		]);
	});
});

// Regression test for the crash a real backfill run hit: `rune_entries` has
// 21 columns, and the original ENTRY_CHUNK_SIZE (5,000, copied from the
// balances/events chunk sizes without checking column count) sent 105,000
// bind parameters in one statement — over Postgres's 65,534 limit
// (MAX_PARAMETERS_EXCEEDED). This asserts every chunk size against its
// table's real column count, so bumping either one out of sync fails here
// instead of mid-backfill.
describe("flush chunk sizes stay under Postgres's parameter limit", () => {
	test("rune_balances upsert chunk", () => {
		expect(
			UPSERT_CHUNK_SIZE * RUNE_BALANCES_PARAMS_PER_ROW,
		).toBeLessThanOrEqual(POSTGRES_MAX_PARAMETERS);
	});

	test("rune_events insert chunk", () => {
		expect(EVENT_CHUNK_SIZE * RUNE_EVENTS_PARAMS_PER_ROW).toBeLessThanOrEqual(
			POSTGRES_MAX_PARAMETERS,
		);
	});

	test("rune_entries upsert chunk", () => {
		expect(ENTRY_CHUNK_SIZE * RUNE_ENTRIES_PARAMS_PER_ROW).toBeLessThanOrEqual(
			POSTGRES_MAX_PARAMETERS,
		);
	});

	test("delete batch size is a sane bound (unnest arrays are 1 param each, not per-row)", () => {
		expect(DELETE_CHUNK_SIZE).toBeGreaterThan(0);
		expect(3).toBeLessThanOrEqual(POSTGRES_MAX_PARAMETERS);
	});
});

// Reviewer-caught defect (plan 039 step 7, live backfill 841,000->900,000): a
// Runestone etching's Symbol tag accepts any u32 codepoint, including 0. An
// entry whose symbol is U+0000 crashed the flush transaction with Postgres
// error 22021 ("invalid byte sequence for encoding UTF8: 0x00") — text
// columns reject a raw NUL byte outright, independent of UTF-8 validity.
describe("symbolForDb", () => {
	test("passes a normal symbol through unchanged", () => {
		expect(symbolForDb("⧉")).toBe("⧉");
	});

	test("maps an absent symbol to null", () => {
		expect(symbolForDb(undefined)).toBeNull();
	});

	test("maps U+0000 to null (Postgres text columns reject a raw NUL byte)", () => {
		expect(symbolForDb("\u0000")).toBeNull();
	});
});

describe("entryToRow", () => {
	function baseEntry(overrides: Partial<RuneEntry> = {}): RuneEntry {
		return {
			block: 842_000n,
			burned: 0n,
			divisibility: 0,
			etching: "a".repeat(64),
			mints: 0n,
			number: 5n,
			premine: 0n,
			rune: 123n,
			spacers: 0,
			symbol: undefined,
			terms: undefined,
			timestamp: 1_700_000_000n,
			turbo: false,
			...overrides,
		};
	}

	test("an entry etched with a U+0000 symbol produces an insertable row (does not throw)", () => {
		const row = entryToRow("842000:1", baseEntry({ symbol: "\u0000" }));
		expect(row.symbol).toBeNull();
	});
});

// Plan 040: `symbol` (text) and "any terms_* column non-null" each lose a
// real, distinct state on the way to Postgres — a U+0000 symbol, and a Terms
// present with every field unset. `symbol_codepoint` and `has_terms` are the
// lossless source of truth `loadState` (via `rowToEntry`) reads instead. Each
// case here round-trips `entryToRow` -> `rowToEntry` and checks both ends.
describe("entryToRow -> rowToEntry round trip (lossless symbol/terms storage)", () => {
	function baseEntry(overrides: Partial<RuneEntry> = {}): RuneEntry {
		return {
			block: 842_000n,
			burned: 0n,
			divisibility: 0,
			etching: "a".repeat(64),
			mints: 0n,
			number: 5n,
			premine: 0n,
			rune: 123n,
			spacers: 0,
			symbol: undefined,
			terms: undefined,
			timestamp: 1_700_000_000n,
			turbo: false,
			...overrides,
		};
	}

	test("(a) a U+0000 symbol survives via symbol_codepoint, even though the lossy text column still nulls it", () => {
		const row = entryToRow("842000:10", baseEntry({ symbol: "\u0000" }));
		expect(row.symbol).toBeNull(); // display-only column, unchanged, still lossy
		expect(row.symbol_codepoint).toBe(0);

		const entry = rowToEntry(row);
		expect(entry.symbol).toBe("\u0000");
	});

	test("(b) no symbol round-trips to undefined", () => {
		const row = entryToRow("842000:11", baseEntry({ symbol: undefined }));
		expect(row.symbol).toBeNull();
		expect(row.symbol_codepoint).toBeNull();

		const entry = rowToEntry(row);
		expect(entry.symbol).toBeUndefined();
	});

	test("(c) terms present with every field undefined round-trips as terms present, all fields undefined", () => {
		const row = entryToRow(
			"842000:12",
			baseEntry({
				terms: {
					amount: undefined,
					cap: undefined,
					height: [undefined, undefined],
					offset: [undefined, undefined],
				},
			}),
		);
		expect(row.has_terms).toBe(true);
		expect(row.terms_amount).toBeNull();
		expect(row.terms_cap).toBeNull();
		expect(row.terms_height_start).toBeNull();
		expect(row.terms_height_end).toBeNull();
		expect(row.terms_offset_start).toBeNull();
		expect(row.terms_offset_end).toBeNull();

		const entry = rowToEntry(row);
		expect(entry.terms).toEqual({
			amount: undefined,
			cap: undefined,
			height: [undefined, undefined],
			offset: [undefined, undefined],
		});
	});

	test("(d) no terms round-trips to undefined", () => {
		const row = entryToRow("842000:13", baseEntry({ terms: undefined }));
		expect(row.has_terms).toBe(false);

		const entry = rowToEntry(row);
		expect(entry.terms).toBeUndefined();
	});
});
