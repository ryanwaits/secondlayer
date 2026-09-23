import { describe, expect, test } from "bun:test";
// Validates state.ts's normalizers/diff against a real ord 0.29.0 sample
// captured live on stacks-feeder (`ord ... runes` / `ord ... balances`,
// height 246,489 — see test/fixtures/sample-ord-*.json). No network access:
// the capture is a committed fixture.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRuneState, seedGenesis, setBalance } from "../runes/state.ts";
import { parseJsonPreservingBigInts } from "./json-bigint.ts";
import {
	type NormalizedBalanceRow,
	buildStateDiffReport,
	diffBalances,
	diffEntries,
	normalizeOrdBalancesJson,
	normalizeOrdRunesJson,
	normalizeOurBalances,
	normalizeOurEntries,
	runeIdByName,
} from "./state.ts";

const fixturesDir = join(import.meta.dir, "..", "..", "test", "fixtures");

function readOrdSample(name: string) {
	const text = readFileSync(join(fixturesDir, name), "utf8");
	return parseJsonPreservingBigInts(text);
}

describe("parity/state against the real ord sample (height 246,489)", () => {
	test("our seedGenesis() entry matches ord's real UNCOMMON•GOODS entry exactly", () => {
		const ordRunes = normalizeOrdRunesJson(
			readOrdSample("sample-ord-runes-246489.json"),
		);
		expect(ordRunes.size).toBe(1);

		const state = createRuneState();
		seedGenesis(state);
		const ourEntries = normalizeOurEntries(state);

		const mismatches = diffEntries(ourEntries, ordRunes);
		expect(mismatches).toEqual([]);
	});

	test("the real (empty) balances sample diffs clean against our fresh (empty) state", () => {
		const ordRunes = normalizeOrdRunesJson(
			readOrdSample("sample-ord-runes-246489.json"),
		);
		const ordBalances = normalizeOrdBalancesJson(
			readOrdSample("sample-ord-balances-246489.json"),
			runeIdByName(ordRunes),
		);
		expect(ordBalances).toEqual([]);

		const state = createRuneState();
		seedGenesis(state);
		const ourBalances = normalizeOurBalances(state);

		expect(diffBalances(ourBalances, ordBalances)).toEqual([]);
	});

	test("buildStateDiffReport is clean end-to-end against the real sample", () => {
		const ordRunes = normalizeOrdRunesJson(
			readOrdSample("sample-ord-runes-246489.json"),
		);
		const ordBalances = normalizeOrdBalancesJson(
			readOrdSample("sample-ord-balances-246489.json"),
			runeIdByName(ordRunes),
		);

		const state = createRuneState();
		seedGenesis(state);

		const report = buildStateDiffReport(
			246_489,
			normalizeOurEntries(state),
			ordRunes,
			normalizeOurBalances(state),
			ordBalances,
		);

		expect(report.runeCounts).toEqual({ ours: 1, ord: 1 });
		expect(report.outpointCounts).toEqual({ ours: 0, ord: 0 });
		expect(report.entryMismatches).toEqual([]);
		expect(report.balanceMismatches).toEqual([]);
	});
});

describe("diffBalances", () => {
	test("reports a synthetic amount mismatch", () => {
		const ours: NormalizedBalanceRow[] = [
			{ outpoint: `${"a".repeat(64)}:0`, runeId: "840000:1", amount: "100" },
		];
		const ord: NormalizedBalanceRow[] = [
			{ outpoint: `${"a".repeat(64)}:0`, runeId: "840000:1", amount: "99" },
		];

		const mismatches = diffBalances(ours, ord);
		expect(mismatches).toEqual([
			{
				kind: "amount-mismatch",
				outpoint: `${"a".repeat(64)}:0`,
				runeId: "840000:1",
				ours: "100",
				ord: "99",
			},
		]);
	});

	test("reports a balance present only on our side", () => {
		const ours: NormalizedBalanceRow[] = [
			{ outpoint: `${"b".repeat(64)}:0`, runeId: "840000:1", amount: "5" },
		];
		const mismatches = diffBalances(ours, []);
		expect(mismatches).toEqual([
			{
				kind: "missing-in-ord",
				outpoint: `${"b".repeat(64)}:0`,
				runeId: "840000:1",
				ours: "5",
			},
		]);
	});

	test("reports a balance present only on ord's side", () => {
		const ord: NormalizedBalanceRow[] = [
			{ outpoint: `${"c".repeat(64)}:0`, runeId: "840000:1", amount: "5" },
		];
		const mismatches = diffBalances([], ord);
		expect(mismatches).toEqual([
			{
				kind: "missing-in-ours",
				outpoint: `${"c".repeat(64)}:0`,
				runeId: "840000:1",
				ord: "5",
			},
		]);
	});
});

describe("diffEntries", () => {
	test("reports a rune missing on our side", () => {
		const ordRunes = normalizeOrdRunesJson(
			readOrdSample("sample-ord-runes-246489.json"),
		);
		const mismatches = diffEntries(new Map(), ordRunes);
		expect(mismatches).toHaveLength(1);
		expect(mismatches[0]?.kind).toBe("missing-in-ours");
		expect((mismatches[0] as { runeId: string }).runeId).toBe("1:0");
	});

	test("reports a rune missing on ord's side", () => {
		const state = createRuneState();
		seedGenesis(state);
		const ours = normalizeOurEntries(state);

		const mismatches = diffEntries(ours, new Map());
		expect(mismatches).toHaveLength(1);
		expect(mismatches[0]?.kind).toBe("missing-in-ord");
		expect((mismatches[0] as { runeId: string }).runeId).toBe("1:0");
	});
});

describe("state.ts helpers exercise the full balances path (sanity, not against the fixture)", () => {
	test("normalizeOurBalances reflects a live balance", () => {
		const state = createRuneState();
		seedGenesis(state);
		setBalance(state, `${"d".repeat(64)}:0`, "1:0", 1n);

		const rows = normalizeOurBalances(state);
		expect(rows).toEqual([
			{ outpoint: `${"d".repeat(64)}:0`, runeId: "1:0", amount: "1" },
		]);
	});
});
