import { describe, expect, test } from "bun:test";
import {
	type TicketRow,
	formatJsonl,
	formatTable,
	parseArgs,
} from "./feedback-queue.ts";

function row(over: Partial<TicketRow> = {}): TicketRow {
	return {
		id: "t1",
		intent: "need a sender filter",
		expected: null,
		kind_hint: null,
		evidence: null,
		attempted: {
			method: "GET",
			path: "/v1/index/transfers",
			code: "INVALID_PARAM",
			query: { sender: "SP2C2SECRET" },
		},
		origin: "api",
		status: "classified",
		route: "human",
		classification: { kind: "perf", reason: "kind:perf" },
		created_at: new Date("2026-10-08T00:00:00Z"),
		...over,
	};
}

describe("parseArgs", () => {
	test("defaults to a 7 day table of 50", () => {
		expect(parseArgs([])).toEqual({
			route: null,
			status: null,
			since_days: 7,
			limit: 50,
			format: "table",
		});
	});
	test("unknown flag throws", () => {
		expect(() => parseArgs(["--delete"])).toThrow("unknown flag");
	});
	test("unknown route throws", () => {
		expect(() => parseArgs(["--route", "nope"])).toThrow("--route");
	});
	test("parses filters and format", () => {
		const a = parseArgs([
			"--route",
			"docs",
			"--status",
			"new",
			"--since",
			"30",
			"--limit",
			"5",
			"--jsonl",
		]);
		expect(a).toMatchObject({
			route: "docs",
			status: "new",
			since_days: 30,
			limit: 5,
			format: "jsonl",
		});
	});
});

describe("formatJsonl", () => {
	test("emits an unlabelled row without query values", () => {
		const line = formatJsonl(row());
		const parsed = JSON.parse(line);
		expect(parsed.labels).toEqual({});
		expect(parsed.state.attempted.query_params).toEqual(["sender"]);
		expect(line).not.toContain("SP2C2SECRET");
	});
});

describe("formatTable", () => {
	test("groups by route and keeps low_priority visible", () => {
		const out = formatTable([row(), row({ id: "t2", route: "low_priority" })]);
		expect(out).toContain("== human (1)");
		expect(out).toContain("== low_priority (1)");
	});
	test("says so when empty", () => {
		expect(formatTable([])).toBe("no tickets");
	});
});
