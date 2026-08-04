import { describe, expect, test } from "bun:test";
import {
	buildWhereConditions,
	parseQueryParams,
} from "../src/routes/subgraph-query-helpers.ts";

// A4: in/notIn filters + multi-column sort, parameterized (injection-safe).
const cols = new Set(["sender", "amount", "status", "_id", "_block_height"]);

describe("parseQueryParams — in/notIn", () => {
	test("in splits comma list into values", () => {
		const p = parseQueryParams({ "status.in": "a,b,c" }, cols);
		expect(p.filters).toEqual([
			{ column: "status", op: "IN", values: ["a", "b", "c"] },
		]);
	});

	test("notIn → NOT IN", () => {
		const p = parseQueryParams({ "status.notIn": "x,y" }, cols);
		expect(p.filters[0]).toMatchObject({ op: "NOT IN", values: ["x", "y"] });
	});

	test("empty in list rejected", () => {
		expect(() => parseQueryParams({ "status.in": " , " }, cols)).toThrow();
	});

	test("in on unknown column rejected", () => {
		expect(() => parseQueryParams({ "bogus.in": "a" }, cols)).toThrow();
	});
});

describe("parseQueryParams — multi-column sort", () => {
	test("_sort=a,b + _order=desc,asc zips into ordered sorts", () => {
		const p = parseQueryParams(
			{ _sort: "amount,_id", _order: "desc,asc" },
			cols,
		);
		expect(p.sorts).toEqual([
			{ column: "amount", order: "DESC" },
			{ column: "_id", order: "ASC" },
		]);
	});

	test("missing _order entries default to ASC", () => {
		const p = parseQueryParams(
			{ _sort: "amount,sender", _order: "desc" },
			cols,
		);
		expect(p.sorts).toEqual([
			{ column: "amount", order: "DESC" },
			{ column: "sender", order: "ASC" },
		]);
	});

	test("unknown sort column rejected", () => {
		expect(() => parseQueryParams({ _sort: "amount,nope" }, cols)).toThrow();
	});

	test("no sort → empty sorts", () => {
		expect(parseQueryParams({}, cols).sorts).toEqual([]);
	});
});

describe("parseQueryParams — _order validation", () => {
	test("_order=amount.desc (column-syntax value) is rejected", () => {
		expect(() =>
			parseQueryParams({ _sort: "amount", _order: "amount.desc" }, cols),
		).toThrow(/_order/);
		expect(() =>
			parseQueryParams({ _sort: "amount", _order: "amount.desc" }, cols),
		).toThrow(/asc.*desc|desc.*asc/i);
	});

	test("_order garbage values (DESCENDING, -amount, 1) are all rejected", () => {
		for (const bad of ["DESCENDING", "-amount", "1", "dsc"]) {
			expect(() => parseQueryParams({ _order: bad }, cols)).toThrow(/_order/);
		}
	});

	test("_order=desc and _order=ASC still work (case-insensitive)", () => {
		const lower = parseQueryParams({ _sort: "amount", _order: "desc" }, cols);
		expect(lower.sorts).toEqual([{ column: "amount", order: "DESC" }]);

		const upper = parseQueryParams({ _sort: "amount", _order: "ASC" }, cols);
		expect(upper.sorts).toEqual([{ column: "amount", order: "ASC" }]);
	});

	test("legacy multi-sort _sort=a,b&_order=desc,asc still zips into two sorts", () => {
		const p = parseQueryParams(
			{ _sort: "amount,_id", _order: "desc,asc" },
			cols,
		);
		expect(p.sorts).toEqual([
			{ column: "amount", order: "DESC" },
			{ column: "_id", order: "ASC" },
		]);
	});
});

describe("parseQueryParams — _search validation", () => {
	const noSearchTableDef = {
		columns: {
			sender: { type: "text" as const },
			amount: { type: "uint" as const },
		},
	};
	const searchableTableDef = {
		columns: {
			sender: { type: "text" as const, search: true },
			amount: { type: "uint" as const },
		},
	};

	test("_search on a table with no searchable columns is rejected", () => {
		expect(() =>
			parseQueryParams({ _search: "x" }, cols, noSearchTableDef, "transfers"),
		).toThrow(/_search/);
		expect(() =>
			parseQueryParams({ _search: "x" }, cols, noSearchTableDef, "transfers"),
		).toThrow(/searchable/);
	});

	test("_search on a table with searchable columns builds the search clause", () => {
		const p = parseQueryParams(
			{ _search: "alice" },
			cols,
			searchableTableDef,
			"transfers",
		);
		expect(p.search).toEqual({ value: "alice", columns: ["sender"] });
	});
});

describe("buildWhereConditions — IN is parameterized", () => {
	test("emits IN ($1,$2,$3) with each value a param (no interpolation)", () => {
		const p = parseQueryParams({ "status.in": "a,b,c" }, cols);
		const params: unknown[] = [];
		const conditions = buildWhereConditions(p, params);
		expect(conditions).toEqual(['"status" IN ($1, $2, $3)']);
		expect(params).toEqual(["a", "b", "c"]);
	});

	test("mixes with binary ops, params stay positional", () => {
		const p = parseQueryParams(
			{ "amount.gte": "100", "status.in": "x,y" },
			cols,
		);
		const params: unknown[] = [];
		const conditions = buildWhereConditions(p, params);
		expect(conditions).toContain('"amount" >= $1');
		expect(conditions).toContain('"status" IN ($2, $3)');
		expect(params).toEqual(["100", "x", "y"]);
	});
});
