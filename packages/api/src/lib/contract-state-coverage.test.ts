import { afterEach, describe, expect, test } from "bun:test";
import { getSourceDb } from "@secondlayer/shared/db";
import { sql } from "kysely";
import {
	type ContractStateCoverageStore,
	type SavedCoverage,
	createContractStateCoverage,
	dropFilled,
	findCanonicalBlocksWithoutStateWrites,
	gapHeightCount,
	mergeGapHeights,
	postgresContractStateCoverageStore,
} from "./contract-state-coverage.ts";

describe("gap range logic", () => {
	test("no heights and no ranges stay empty", () => {
		expect(mergeGapHeights([], [])).toEqual([]);
		expect(dropFilled([], [])).toEqual([]);
		expect(gapHeightCount([])).toBe(0);
	});

	test("a single height becomes a one-height range", () => {
		expect(mergeGapHeights([], [7])).toEqual([{ from: 7, to: 7 }]);
	});

	test("adjacent heights coalesce into the existing range", () => {
		expect(mergeGapHeights([{ from: 5, to: 7 }], [8])).toEqual([
			{ from: 5, to: 8 },
		]);
		expect(mergeGapHeights([{ from: 5, to: 7 }], [9])).toEqual([
			{ from: 5, to: 7 },
			{ from: 9, to: 9 },
		]);
	});

	test("unsorted and duplicate heights are sorted and merged", () => {
		expect(mergeGapHeights([], [10, 3, 4, 11, 4, 1])).toEqual([
			{ from: 1, to: 1 },
			{ from: 3, to: 4 },
			{ from: 10, to: 11 },
		]);
	});

	test("filling a middle height splits a range", () => {
		expect(dropFilled([{ from: 5, to: 9 }], [5, 6, 8, 9])).toEqual([
			{ from: 5, to: 6 },
			{ from: 8, to: 9 },
		]);
	});

	test("dropFilled ignores heights outside the given ranges", () => {
		expect(dropFilled([{ from: 5, to: 6 }], [1, 5, 20])).toEqual([
			{ from: 5, to: 5 },
		]);
		expect(dropFilled([{ from: 5, to: 6 }], [])).toEqual([]);
	});

	test("count sums every height across ranges", () => {
		expect(
			gapHeightCount([
				{ from: 1, to: 1 },
				{ from: 3, to: 6 },
			]),
		).toBe(5);
	});
});

type MemoryStore = ContractStateCoverageStore & {
	saved: SavedCoverage | null;
	claimed: boolean;
	saves: SavedCoverage[];
};

function memoryStore(saved: SavedCoverage | null = null, claimable = true) {
	const store: MemoryStore = {
		saved,
		claimed: false,
		saves: [],
		load: async () => store.saved,
		claim: async () => {
			if (!claimable || store.claimed) return false;
			store.claimed = true;
			return true;
		},
		save: async (state) => {
			store.saved = state;
			store.saves.push(state);
		},
		release: async () => {
			store.claimed = false;
		},
	};
	return store;
}

function fakeChain(missing: Set<number>) {
	const calls: Array<[number, number]> = [];
	return {
		missing,
		calls,
		findMissing: async (from: number, to: number) => {
			calls.push([from, to]);
			return [...missing]
				.filter((h) => h >= from && h <= to)
				.sort((a, b) => a - b);
		},
	};
}

const bounds = (finalized: number) => async () => ({
	tip: finalized + 5,
	finalized,
});

describe("contract state coverage scanner", () => {
	test("first pass records gaps and the scanned range", async () => {
		const chain = fakeChain(new Set([3, 4, 9]));
		const scanner = createContractStateCoverage({
			store: memoryStore(),
			readBounds: bounds(10),
			readFromHeight: async () => 1,
			findMissing: chain.findMissing,
		});
		expect(scanner.read()).toBeNull();
		await scanner.refresh();
		expect(scanner.read()).toEqual({
			from_height: 1,
			checked_through: 10,
			gap_heights: 3,
			gaps: [
				{ from: 3, to: 4 },
				{ from: 9, to: 9 },
			],
		});
	});

	test("second pass scans only new heights and rechecks stored gaps", async () => {
		const chain = fakeChain(new Set([3, 4]));
		let finalized = 10;
		const store = memoryStore();
		const scanner = createContractStateCoverage({
			store,
			readBounds: async () => ({ tip: finalized, finalized }),
			readFromHeight: async () => 1,
			findMissing: chain.findMissing,
			refreshMs: 0,
		});
		await scanner.refresh();
		chain.calls.length = 0;
		finalized = 14;
		chain.missing.add(12);
		await scanner.refresh();
		expect(chain.calls).toEqual([
			[3, 4],
			[11, 14],
		]);
		expect(scanner.read()?.gaps).toEqual([
			{ from: 3, to: 4 },
			{ from: 12, to: 12 },
		]);
	});

	test("a backfilled gap disappears", async () => {
		const chain = fakeChain(new Set([3, 4, 5]));
		const scanner = createContractStateCoverage({
			store: memoryStore(),
			readBounds: bounds(10),
			readFromHeight: async () => 1,
			findMissing: chain.findMissing,
			refreshMs: 0,
		});
		await scanner.refresh();
		chain.missing.delete(4);
		await scanner.refresh();
		expect(scanner.read()?.gaps).toEqual([
			{ from: 3, to: 3 },
			{ from: 5, to: 5 },
		]);
		expect(scanner.read()?.gap_heights).toBe(2);
		chain.missing.clear();
		await scanner.refresh();
		expect(scanner.read()?.gap_heights).toBe(0);
	});

	test("a process that loses the claim serves the stored value without scanning", async () => {
		const chain = fakeChain(new Set());
		const store = memoryStore(
			{
				fromHeight: 1,
				checkedThrough: 8,
				gaps: [{ from: 2, to: 2 }],
				gapHeights: 1,
			},
			false,
		);
		const scanner = createContractStateCoverage({
			store,
			readBounds: bounds(10),
			readFromHeight: async () => 1,
			findMissing: chain.findMissing,
		});
		await scanner.refresh();
		expect(chain.calls).toEqual([]);
		expect(scanner.read()).toEqual({
			from_height: 1,
			checked_through: 8,
			gap_heights: 1,
			gaps: [{ from: 2, to: 2 }],
		});
	});

	test("progress is saved per chunk so a crash keeps finished chunks", async () => {
		const store = memoryStore();
		const scanner = createContractStateCoverage({
			store,
			readBounds: bounds(30),
			readFromHeight: async () => 1,
			chunkBlocks: 10,
			findMissing: async (from) => {
				if (from === 11) throw new Error("boom");
				return from === 1 ? [4] : [];
			},
		});
		await expect(scanner.refresh()).rejects.toThrow("boom");
		expect(store.saved?.checkedThrough).toBe(10);
		expect(store.saved?.gaps).toEqual([{ from: 4, to: 4 }]);
		expect(store.claimed).toBe(false);
	});

	test("no state writes at all reports an empty coverage", async () => {
		const scanner = createContractStateCoverage({
			store: memoryStore(),
			readBounds: bounds(10),
			readFromHeight: async () => null,
			findMissing: async () => [],
		});
		await scanner.refresh();
		expect(scanner.read()).toEqual({
			from_height: null,
			checked_through: null,
			gap_heights: 0,
			gaps: [],
		});
	});

	test("stored ranges are capped but every gap height is still counted", async () => {
		const missing = new Set([2, 4, 6, 8]);
		const scanner = createContractStateCoverage({
			store: memoryStore(),
			readBounds: bounds(10),
			readFromHeight: async () => 1,
			findMissing: fakeChain(missing).findMissing,
			maxStoredRanges: 2,
		});
		await scanner.refresh();
		expect(scanner.read()?.gap_heights).toBe(4);
		expect(scanner.read()?.gaps).toEqual([
			{ from: 2, to: 2 },
			{ from: 4, to: 4 },
		]);
	});

	test("unavailable chain bounds report null", async () => {
		const scanner = createContractStateCoverage({
			store: memoryStore(),
			readBounds: async () => null,
			readFromHeight: async () => 1,
			findMissing: async () => [],
		});
		await scanner.refresh();
		expect(scanner.read()).toBeNull();
	});

	test("loads coverage state after winning the claim", async () => {
		const chain = fakeChain(new Set());
		const store = memoryStore({
			fromHeight: 1,
			checkedThrough: 10,
			gaps: [],
			gapHeights: 0,
		});
		store.claim = async () => {
			store.saved = {
				fromHeight: 1,
				checkedThrough: 20,
				gaps: [],
				gapHeights: 0,
			};
			store.claimed = true;
			return true;
		};
		const scanner = createContractStateCoverage({
			store,
			readBounds: bounds(15),
			readFromHeight: async () => 1,
			findMissing: chain.findMissing,
		});
		await scanner.refresh();
		expect(chain.calls).toEqual([]);
		expect(store.saved?.checkedThrough).toBe(20);
		expect(scanner.read()?.checked_through).toBe(20);
	});

	test("lowering fromHeight resets truncated gap counts instead of double-counting", async () => {
		const chain = fakeChain(new Set([5, 12, 14, 16, 18]));
		let fromHeight = 10;
		const store = memoryStore();
		const scanner = createContractStateCoverage({
			store,
			readBounds: bounds(20),
			readFromHeight: async () => fromHeight,
			findMissing: chain.findMissing,
			maxStoredRanges: 2,
			refreshMs: 0,
		});
		await scanner.refresh();
		expect(scanner.read()?.gap_heights).toBe(4);
		expect(scanner.read()?.gaps).toEqual([
			{ from: 12, to: 12 },
			{ from: 14, to: 14 },
		]);

		fromHeight = 1;
		await scanner.refresh();
		expect(scanner.read()?.from_height).toBe(1);
		expect(scanner.read()?.gap_heights).toBe(5);
		expect(scanner.read()?.gaps).toEqual([
			{ from: 5, to: 5 },
			{ from: 12, to: 12 },
		]);
	});
});

const HAS_DB = !!process.env.DATABASE_URL;
const BASE = 9_900_000;

describe.skipIf(!HAS_DB)("contract state coverage against postgres", () => {
	const db = HAS_DB ? getSourceDb() : null;

	async function clean() {
		if (!db) return;
		await sql`DELETE FROM state_writes WHERE block_height > ${BASE} AND block_height <= ${BASE + 5}`.execute(
			db,
		);
		await sql`DELETE FROM blocks WHERE height > ${BASE} AND height <= ${BASE + 5}`.execute(
			db,
		);
		await sql`DELETE FROM contract_state_coverage`.execute(db);
	}

	afterEach(clean);

	test("finds the canonical block with no state_writes rows", async () => {
		if (!db) return;
		await clean();
		for (let i = 1; i <= 5; i++) {
			const height = BASE + i;
			await db
				.insertInto("blocks")
				.values({
					height,
					hash: `0xcsc${height}`,
					parent_hash: `0xcsc${height - 1}`,
					burn_block_height: height,
					burn_block_hash: "0xburn",
					index_block_hash: null,
					timestamp: 1_700_000_000 + i,
					canonical: true,
				})
				.execute();
			if (i !== 3) {
				await sql`
					INSERT INTO state_writes (block_height, ordinal, key, value_hex)
					VALUES (${height}, 0, 'k', '00')
				`.execute(db);
			}
		}
		expect(
			await findCanonicalBlocksWithoutStateWrites(BASE + 1, BASE + 5, db),
		).toEqual([BASE + 3]);
	});

	test("store claim is exclusive until released and round-trips state", async () => {
		const a = postgresContractStateCoverageStore();
		const b = postgresContractStateCoverageStore();
		expect(await a.claim()).toBe(true);
		expect(await b.claim()).toBe(false);
		const state = {
			fromHeight: 1,
			checkedThrough: 9,
			gaps: [{ from: 3, to: 4 }],
			gapHeights: 2,
		};
		await a.save(state);
		expect(await b.load()).toEqual(state);
		await a.release();
		expect(await b.claim()).toBe(true);
	});
});
