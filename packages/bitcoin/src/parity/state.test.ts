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
	normalizeOurEntry,
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

// Plan 040 (e): a `Terms` present with every field undefined (the shape
// `rowToEntry` builds from `has_terms=true` and all-null terms_* columns,
// see ../db/store.test.ts case (c)) must normalize to ord's exact JSON shape
// for an empty terms object, or the C1 comparison flags a false mismatch
// (caught live at 841,000, rune 840257:557: ord had
// `terms: {amount:null,cap:null,height:[null,null],offset:[null,null]}`, we
// had `terms: null`).
describe("normalizeOurEntry: terms present with every field undefined", () => {
	test("normalizes to ord's all-null terms object shape, not null", () => {
		const info = normalizeOurEntry("840257:557", {
			block: 840_257n,
			burned: 0n,
			divisibility: 0,
			etching: "a".repeat(64),
			mints: 0n,
			number: 1n,
			premine: 0n,
			rune: 999n,
			spacers: 0,
			symbol: undefined,
			terms: {
				amount: undefined,
				cap: undefined,
				height: [undefined, undefined],
				offset: [undefined, undefined],
			},
			timestamp: 1_700_000_000n,
			turbo: false,
		});

		expect(info.terms).toEqual({
			amount: null,
			cap: null,
			height: [null, null],
			offset: [null, null],
		});
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
