import { describe, expect, test } from "bun:test";
import { recentRowsData, sortRecent } from "./recent-rows-model";

const row = (table: string, block: number, id: number) => ({
	table,
	row: { _block_height: block, _id: id },
});

describe("sortRecent", () => {
	test("orders newest block first, then newest id", () => {
		const sorted = sortRecent([
			row("a", 5, 1),
			row("b", 7, 9),
			row("a", 7, 2),
			row("b", 6, 3),
		]);
		expect(sorted.map((r) => `${r.table}${r.row._block_height}`)).toEqual([
			"b7",
			"a7",
			"b6",
			"a5",
		]);
	});
});

describe("recentRowsData", () => {
	test("a read that landed is the rows, however few", () => {
		expect(recentRowsData([])).toEqual({ rows: [], failed: false });
		expect(recentRowsData([row("a", 1, 1)])).toEqual({
			rows: [row("a", 1, 1)],
			failed: false,
		});
	});

	test("a read that failed is a failure, not an empty list", () => {
		expect(recentRowsData(null)).toEqual({ rows: [], failed: true });
	});
});
