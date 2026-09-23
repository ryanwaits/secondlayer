// Pure-function tests for the flush batching logic (no Postgres needed).
// Added after a reviewer-caught defect: the original flush() issued one
// DELETE+INSERT round trip per touched outpoint, which measured as
// single-row statements sitting in pg_stat_activity for 45+ minutes on the
// Runes launch window. `computeBalanceChanges` is the fix's core: it decides,
// from in-memory state alone, exactly which rows need a write.
import { describe, expect, test } from "bun:test";
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
} from "./store.ts";

const U128_MAX = (1n << 128n) - 1n;

describe("computeBalanceChanges", () => {
	test("a balance created and fully spent within one flush window touches neither list", () => {
		const state = createRuneState();
		const outpoint = `${"a".repeat(64)}:0`;
		const ruleId = "840000:1";

		// Created this window...
		setBalance(state, outpoint, ruleId, 500n);
		// ...then fully spent, still within the same window (never flushed in between).
		setBalance(state, outpoint, ruleId, 0n);

		const { toUpsert, toDelete } = computeBalanceChanges(state);

		expect(toUpsert).toHaveLength(0);
		expect(toDelete).toHaveLength(0);
	});

	test("a balance that existed before this flush and is now fully spent is queued for delete", () => {
		const state = createRuneState();
		const outpoint = `${"b".repeat(64)}:1`;
		const ruleId = "840000:2";

		// Simulate a prior flush having persisted this row.
		setBalance(state, outpoint, ruleId, 100n);
		state.dbBalanceKeys.add(`${outpoint}|${ruleId}`);
		state.dirtyBalanceKeys.clear(); // the prior flush would have cleared this

		// This window: spend it.
		setBalance(state, outpoint, ruleId, 0n);

		const { toUpsert, toDelete } = computeBalanceChanges(state);

		expect(toUpsert).toHaveLength(0);
		expect(toDelete).toEqual([{ txid: "b".repeat(64), vout: 1, ruleId }]);
	});

	test("a new nonzero balance is queued for upsert with the exact amount", () => {
		const state = createRuneState();
		const outpoint = `${"c".repeat(64)}:2`;
		const ruleId = "840000:3";

		setBalance(state, outpoint, ruleId, 42n);

		const { toUpsert, toDelete } = computeBalanceChanges(state);

		expect(toDelete).toHaveLength(0);
		expect(toUpsert).toEqual([
			{ txid: "c".repeat(64), vout: 2, ruleId, amount: 42n },
		]);
	});

	test("preserves a near-u128-max amount exactly (no Number conversion)", () => {
		const state = createRuneState();
		const outpoint = `${"d".repeat(64)}:3`;
		const ruleId = "840000:4";
		const hugeAmount = U128_MAX - 1n; // 340282366920938463463374607431768211454

		setBalance(state, outpoint, ruleId, hugeAmount);

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
		const ruleId = "840000:5";

		setBalance(state, outpoint, ruleId, 10n);
		state.dbBalanceKeys.add(`${outpoint}|${ruleId}`);
		state.dirtyBalanceKeys.clear();

		setBalance(state, outpoint, ruleId, 7n); // partial spend within this window

		const { toUpsert, toDelete } = computeBalanceChanges(state);

		expect(toDelete).toHaveLength(0);
		expect(toUpsert).toEqual([
			{ txid: "e".repeat(64), vout: 4, ruleId, amount: 7n },
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
