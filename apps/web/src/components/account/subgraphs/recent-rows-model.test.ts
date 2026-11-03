import { describe, expect, test } from "bun:test";
import {
	KEPT_ROWS,
	MAX_TABLES,
	biggestTables,
	foldRecentRows,
	sortRecent,
} from "./recent-rows-model";

const row = (table: string, block: number, id: number) => ({
	table,
	row: { _block_height: block, _id: id },
});

describe("biggestTables", () => {
	test("orders by row count and stops at the cap", () => {
		const tables = Object.fromEntries(
			Array.from({ length: MAX_TABLES + 3 }, (_, i) => [
				`t${i}`,
				{ rowCount: i },
			]),
		);
		const picked = biggestTables(tables);
		expect(picked).toHaveLength(MAX_TABLES);
		expect(picked[0]).toBe(`t${MAX_TABLES + 2}`);
	});
});

describe("foldRecentRows", () => {
	test("merges the tables newest block first, then newest id", () => {
		const { rows, failed } = foldRecentRows(
			["a", "b"],
			[
				[row("a", 5, 1), row("a", 7, 2)],
				[row("b", 7, 9), row("b", 6, 3)],
			],
		);
		expect(failed).toBe(false);
		expect(rows.map((r) => `${r.table}${r.row._block_height}`)).toEqual([
			"b7",
			"a7",
			"b6",
			"a5",
		]);
	});

	test("one failed table leaves its rows out", () => {
		const { rows, failed } = foldRecentRows(
			["a", "b"],
			[[row("a", 1, 1)], null],
		);
		expect(failed).toBe(false);
		expect(rows).toHaveLength(1);
	});

	test("every table failing is a failure", () => {
		expect(foldRecentRows(["a", "b"], [null, null])).toEqual({
			rows: [],
			failed: true,
		});
	});

	test("a subgraph with no tables is empty, not failed", () => {
		expect(foldRecentRows([], [])).toEqual({ rows: [], failed: false });
	});

	test("keeps only the newest rows", () => {
		const many = Array.from({ length: KEPT_ROWS + 5 }, (_, i) =>
			row("a", i, i),
		);
		const { rows } = foldRecentRows(["a"], [many]);
		expect(rows).toHaveLength(KEPT_ROWS);
		expect(rows[0]).toEqual(sortRecent(many)[0]);
	});
});
