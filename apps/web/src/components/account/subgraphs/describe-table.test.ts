import { describe, expect, test } from "bun:test";
import type { SubgraphSourceInfo } from "@/lib/subgraphs-store";
import { describeTable } from "./describe-table";
import { PERF_TEST_SBTC_SOURCE, perfTestSbtcDetail } from "./subgraph.fixtures";

const sources = perfTestSbtcDetail.sources as Record<
	string,
	SubgraphSourceInfo
>;

const plain = (pieces: { text: string }[]) =>
	pieces.map((piece) => piece.text).join("");

describe("describeTable", () => {
	test("finds the handler that writes completed_deposit, its start line and its refs", () => {
		const description = describeTable({
			table: "completed_deposit",
			rowCount: 63_194,
			columns: [],
			sources,
			sourceCode: PERF_TEST_SBTC_SOURCE,
		});
		expect(description.start).toBe(134);
		expect(description.type).toBe("print_event");
		expect(description.code).toContain("ctx.insert('completed_deposit'");
		expect(description.code).toContain("// !ref(1:1) event");
		expect(description.code).toContain("// !ref(1:6) columns");
		expect(description.code?.split("\n")[1]).toContain("completedDeposit:");
		expect(plain(description.line)).toBe(
			"Rows from completed-deposit prints · ≈63,194 rows",
		);
		expect(description.line.find((piece) => piece.code)?.text).toBe(
			"completed-deposit",
		);
		expect(
			description.prose.filter((s) => s.focus).map((s) => s.focus),
		).toEqual(["event", "columns"]);
		expect(plain(description.prose.flatMap((s) => s.pieces))).toBe(
			"Writes one row for every completed-deposit print from sbtc-registry, with 6 columns copied from the event. About 63,194 rows so far.",
		);
	});

	test("counts four columns for key_rotation, starting at its own handler", () => {
		const description = describeTable({
			table: "key_rotation",
			rowCount: 8,
			columns: [],
			sources,
			sourceCode: PERF_TEST_SBTC_SOURCE,
		});
		expect(description.start).toBe(176);
		expect(description.code).toContain("// !ref(1:4) columns");
		expect(description.code?.endsWith("\t\t},")).toBe(true);
	});

	test("finds a handler written with double quotes and an async arrow", () => {
		const sourceCode = [
			"export default defineSubgraph({",
			"  handlers: {",
			"    transferred: async (event, ctx) => {",
			'      await ctx.upsert("transfers", { id: 1 }, {',
			"        amount: event.amount,",
			"        memo: event.memo,",
			"      });",
			"    },",
			"  },",
			"});",
		].join("\n");
		const description = describeTable({
			table: "transfers",
			rowCount: 2,
			columns: ["amount", "memo"],
			sources: {},
			sourceCode,
		});
		expect(description.start).toBe(3);
		expect(description.code).toContain("// !ref(1:1) event");
		expect(description.code).not.toBeNull();
		expect(plain(description.line)).toBe(
			"Rows from the transferred handler · ≈2 rows",
		);
	});

	test("a table nothing in the source writes has no code and no focus links", () => {
		const description = describeTable({
			table: "ghost",
			rowCount: 0,
			columns: ["a", "b"],
			sources,
			sourceCode: PERF_TEST_SBTC_SOURCE,
		});
		expect(description.code).toBeNull();
		expect(description.prose.some((s) => s.focus)).toBe(false);
		expect(plain(description.line)).toBe("≈0 rows");
		expect(plain(description.line)).not.toContain("handler");
		expect(plain(description.prose.flatMap((s) => s.pieces))).toBe(
			"2 columns. About 0 rows so far.",
		);
	});

	test("without source code there is no code, no focus links and no handler named", () => {
		const description = describeTable({
			table: "completed_deposit",
			rowCount: 5,
			columns: ["amount"],
			sources,
			sourceCode: null,
		});
		expect(description.code).toBeNull();
		expect(description.prose.some((s) => s.focus)).toBe(false);
		expect(plain(description.line)).toBe("≈5 rows");
		expect(plain(description.line)).not.toContain("handler");
		expect(plain(description.prose.flatMap((s) => s.pieces))).not.toContain(
			"handler",
		);
	});
});
