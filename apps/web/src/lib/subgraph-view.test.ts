import { describe, expect, test } from "bun:test";
import {
	DEFAULT_SORT,
	blocksLabel,
	canFilter,
	formatBytes,
	formatCell,
	gridColumns,
	groupDigits,
	handlerErrors24h,
	isLive,
	queryCommand,
	rowsQuery,
	sdkSnippet,
	shortCount,
	stateLine,
	subgraphTone,
	toggleSort,
	withFilter,
} from "./subgraph-view";

const COLUMNS = {
	kind: { type: "text" },
	sender: { type: "principal", nullable: true },
	amount: { type: "uint" },
	meta: { type: "jsonb" },
	_id: { type: "serial" },
	_block_height: { type: "bigint" },
	_tx_id: { type: "text" },
	_created_at: { type: "timestamp" },
};

describe("gridColumns", () => {
	test("block height first, own columns in definition order, tx id last, ids hidden", () => {
		expect(gridColumns(COLUMNS).map((c) => c.name)).toEqual([
			"_block_height",
			"kind",
			"sender",
			"amount",
			"meta",
			"_tx_id",
		]);
	});

	test("uint, int and the system bigint are numeric; text and principal are not", () => {
		const byName = Object.fromEntries(
			gridColumns({ ...COLUMNS, n: { type: "int" } }).map((c) => [
				c.name,
				c.numeric,
			]),
		);
		expect(byName).toMatchObject({
			_block_height: true,
			amount: true,
			n: true,
			kind: false,
			sender: false,
			_tx_id: false,
		});
	});
});

describe("formatCell", () => {
	test("null is the faint word null", () => {
		expect(formatCell("principal", "sender", null)).toEqual({
			text: "null",
			tone: "faint",
		});
	});

	test("principals shorten in the middle and keep the full value", () => {
		const full = "SP35E2BBMDT2DEEZEXAMPLEPRINCIPAL0000DEEZ";
		expect(formatCell("principal", "sender", full)).toEqual({
			text: "SP35E…DEEZ",
			title: full,
			tone: "ink",
		});
	});

	test("a short principal stays whole", () => {
		expect(formatCell("principal", "sender", "SP123")).toEqual({
			text: "SP123",
			tone: "ink",
		});
	});

	test("a tx id shows 0x, four, an ellipsis and four, in the sub tone", () => {
		const full = `0x5cec${"0".repeat(52)}8a75`;
		expect(formatCell("text", "_tx_id", full)).toEqual({
			text: "0x5cec…8a75",
			title: full,
			tone: "sub",
		});
	});

	test("numbers group in threes without losing digits past 2^53", () => {
		expect(formatCell("uint", "amount", "123456789012345678901").text).toBe(
			"123,456,789,012,345,678,901",
		);
		expect(formatCell("bigint", "_block_height", 9218411).text).toBe(
			"9,218,411",
		);
		expect(formatCell("int", "n", "-1234").text).toBe("-1,234");
		expect(formatCell("uint", "amount", "0").text).toBe("0");
	});

	test("jsonb is compact and cut at 60 characters", () => {
		const cell = formatCell("jsonb", "meta", { a: "x".repeat(80) });
		expect(cell.text).toHaveLength(61);
		expect(cell.text.endsWith("…")).toBe(true);
		expect(cell.title).toBe(JSON.stringify({ a: "x".repeat(80) }));
		expect(formatCell("jsonb", "meta", { a: 1 }).text).toBe('{"a":1}');
	});

	test("timestamps read as UTC date-times", () => {
		expect(formatCell("timestamp", "t", "2026-10-15T12:34:56.789Z").text).toBe(
			"2026-10-15T12:34:56Z",
		);
	});
});

describe("groupDigits", () => {
	test("leaves non-digit strings alone", () => {
		expect(groupDigits("1.5")).toBe("1.5");
		expect(groupDigits("abc")).toBe("abc");
	});
});

describe("canFilter", () => {
	test("scalars filter; ids, write times, jsonb and null do not", () => {
		expect(canFilter("text", "kind", "burn")).toBe(true);
		expect(canFilter("uint", "amount", "5")).toBe(true);
		expect(canFilter("text", "_tx_id", "0xabc")).toBe(true);
		expect(canFilter("serial", "_id", 4)).toBe(false);
		expect(canFilter("timestamp", "_created_at", "2026-01-01")).toBe(false);
		expect(canFilter("jsonb", "meta", { a: 1 })).toBe(false);
		expect(canFilter("text", "kind", null)).toBe(false);
	});
});

describe("toggleSort", () => {
	test("a new column starts desc, then asc, then desc again", () => {
		const first = toggleSort(DEFAULT_SORT, "amount");
		expect(first).toEqual({ column: "amount", order: "desc" });
		const second = toggleSort(first, "amount");
		expect(second).toEqual({ column: "amount", order: "asc" });
		expect(toggleSort(second, "amount")).toEqual({
			column: "amount",
			order: "desc",
		});
	});
});

describe("withFilter", () => {
	test("a second filter on the same column replaces the first", () => {
		const one = withFilter([], { column: "kind", value: "burn" });
		const two = withFilter(one, { column: "sender", value: "SP1" });
		expect(withFilter(two, { column: "kind", value: "mint" })).toEqual([
			{ column: "sender", value: "SP1" },
			{ column: "kind", value: "mint" },
		]);
	});
});

describe("queryCommand", () => {
	const base = {
		name: "sbtc-deposits",
		table: "transfers",
		sort: "_block_height",
		order: "desc" as const,
	};

	test("always passes --order", () => {
		expect(queryCommand({ ...base, filters: [] })).toBe(
			"sl subgraphs query sbtc-deposits transfers --sort _block_height --order desc",
		);
	});

	test("adds one --filter per chip and quotes values that need it", () => {
		expect(
			queryCommand({
				...base,
				filters: [
					{ column: "kind", value: "burn" },
					{ column: "note", value: "two words" },
				],
			}),
		).toBe(
			"sl subgraphs query sbtc-deposits transfers --sort _block_height --order desc --filter kind=burn --filter 'note=two words'",
		);
	});
});

describe("sdkSnippet", () => {
	const base = {
		name: "sbtc-deposits",
		table: "transfers",
		sort: "_block_height",
		order: "desc" as const,
	};

	test("omits the filters line when there are none", () => {
		expect(sdkSnippet({ ...base, filters: [] })).toBe(
			[
				'const { rows, next_cursor } = await sl.subgraphs.rows("sbtc-deposits", "transfers", {',
				'  sort: "_block_height", order: "desc", limit: 25,',
				"})",
			].join("\n"),
		);
	});

	test("lists the filters as an object", () => {
		expect(
			sdkSnippet({ ...base, filters: [{ column: "kind", value: "burn" }] }),
		).toContain('  filters: { "kind": "burn" },');
	});
});

describe("rowsQuery", () => {
	test("sort, order and page size lead; filters and the cursor follow", () => {
		expect(
			rowsQuery({
				sort: "amount",
				order: "desc",
				filters: [{ column: "kind", value: "burn" }],
				cursor: "abc",
			}),
		).toBe("_sort=amount&_order=desc&_limit=25&kind=burn&cursor=abc");
	});

	test("no cursor on the first page", () => {
		expect(rowsQuery({ sort: "a", order: "asc", filters: [] })).toBe(
			"_sort=a&_order=asc&_limit=25",
		);
	});
});

describe("counts and lag", () => {
	test("under two blocks counts as live", () => {
		expect(isLive(0)).toBe(true);
		expect(isLive(1)).toBe(true);
		expect(isLive(2)).toBe(false);
	});

	test("short counts and storage", () => {
		expect(shortCount(412_880)).toBe("413k");
		expect(shortCount(31_077)).toBe("31k");
		expect(shortCount(241)).toBe("241");
		expect(shortCount(1_250_000)).toBe("1.3M");
		expect(formatBytes(1_200_000_000)).toBe("1.2 GB");
		expect(formatBytes(340_000_000)).toBe("340 MB");
	});

	test("state line", () => {
		expect(stateLine(1, 412_880, 0)).toBe(
			"At the tip · 412,880 rows · 0 errors 24h",
		);
		expect(stateLine(40, 1, 2)).toBe(
			`Behind tip ${blocksLabel(40)} · 1 row · 2 errors 24h`,
		);
		expect(stateLine(5, 10, null)).toBe("Behind tip 5 blocks · 10 rows");
		expect(stateLine(300, 10, 0, "reindexing")).toBe(
			"Reindexing · 300 blocks left · 10 rows · 0 errors 24h",
		);
	});

	test("handler errors in 24h sum the newest 24 hourly buckets", () => {
		const hours = Array.from({ length: 30 }, (_, i) => ({
			errors: i < 6 ? 100 : 1,
		}));
		expect(handlerErrors24h({ hours })).toBe(24);
		expect(handlerErrors24h({ hours: [] })).toBe(0);
		expect(handlerErrors24h(undefined)).toBeNull();
	});

	test("tone is red for errors, quiet when not active", () => {
		expect(subgraphTone("active", 0)).toBe("ok");
		expect(subgraphTone("active", null)).toBe("ok");
		expect(subgraphTone("active", 2)).toBe("alarm");
		expect(subgraphTone("error", 0)).toBe("alarm");
		expect(subgraphTone("reindexing", 0)).toBe("idle");
	});
});
