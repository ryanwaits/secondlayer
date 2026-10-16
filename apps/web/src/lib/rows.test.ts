import { describe, expect, test } from "bun:test";
import {
	type RowsAllowance,
	type RowsDay,
	type RowsError,
	clientErrors,
	dailyBars,
	errorSummary,
	hourlyPoints,
	markIndex,
	serverErrors,
	shortenPath,
	statusCopy,
	xLabels,
} from "./rows";

const NOW = new Date("2026-10-15T12:00:00.000Z");

const day = (
	date: string,
	source: string,
	freeRows: number,
	paidRows: number,
): RowsDay => ({
	date,
	source,
	rows: freeRows + paidRows,
	freeRows,
	paidRows,
	calls: 1,
	paidUsdMicros: "0",
});

describe("dailyBars", () => {
	test("returns 30 days ending today, zero-filled, summing sources", () => {
		const bars = dailyBars(
			[
				day("2026-10-14", "index", 100, 0),
				day("2026-10-14", "streams", 20, 5),
				day("2026-10-15", "index", 0, 40),
			],
			NOW,
		);
		expect(bars).toHaveLength(30);
		expect(bars[0]).toEqual({ date: "2026-09-16", t: "09-16", n: 0, p: 0 });
		expect(bars[28]).toEqual({ date: "2026-10-14", t: "10-14", n: 120, p: 5 });
		expect(bars[29]).toEqual({ date: "2026-10-15", t: "10-15", n: 0, p: 40 });
		expect(bars[10]?.n).toBe(0);
	});
});

describe("markIndex", () => {
	const bars = dailyBars([], NOW);
	test("sits at the left edge of the bar after the exhaustion day", () => {
		expect(markIndex(bars, "2026-10-06")).toBe(21);
	});
	test("when the allowance ran out today it stays on the last bar", () => {
		expect(markIndex(bars, "2026-10-15")).toBe(29);
	});
	test("is null when not exhausted or outside the window", () => {
		expect(markIndex(bars, null)).toBeNull();
		expect(markIndex(bars, "2026-08-01")).toBeNull();
	});
});

describe("xLabels", () => {
	const bars = dailyBars([], NOW);
	test("labels the first day, the 1st, the exhaustion day and today", () => {
		expect(xLabels(bars, "2026-10-06")).toEqual([
			[0, "Sep 16"],
			[15, "Oct 1"],
			[20, "Oct 6"],
			[29, "Oct 15"],
		]);
	});
	test("drops a label that collides with an earlier one", () => {
		// The exhaustion day is the 1st: one label, not two.
		expect(xLabels(bars, "2026-10-01")).toEqual([
			[0, "Sep 16"],
			[15, "Oct 1"],
			[29, "Oct 15"],
		]);
	});
	test("without exhaustion there is no exhaustion label", () => {
		expect(xLabels(bars, null).map(([, label]) => label)).toEqual([
			"Sep 16",
			"Oct 1",
			"Oct 15",
		]);
	});
});

describe("statusCopy", () => {
	const base: RowsAllowance = {
		monthly: 1_000_000,
		usedThisMonth: 1_263_171,
		exhaustedOn: "2026-10-06",
		paidRowsThisMonth: 263_171,
		paidUsdMicrosThisMonth: "1316000",
		resetsOn: "2026-11-01",
	};
	test("allowance used up: the day, paid rows and paid dollars", () => {
		const { sentence, sub } = statusCopy(base);
		expect(sentence).toBe("1.26M rows this month.");
		expect(sub).toBe(
			"The free 1M ran out on Oct 6. 263,171 paid rows since, $1.32. Block headers are always free.",
		);
	});
	test("under the allowance: how much is used and when it resets", () => {
		const { sentence, sub } = statusCopy({
			...base,
			usedThisMonth: 42_000,
			exhaustedOn: null,
			paidRowsThisMonth: 0,
			paidUsdMicrosThisMonth: "0",
		});
		expect(sentence).toBe("42,000 rows this month.");
		expect(sub).toBe(
			"42,000 of your free 1M used. Resets Nov 1. Block headers are always free.",
		);
	});
});

describe("errors", () => {
	const errors: RowsError[] = [
		{ status: 404, code: "NOT_FOUND", path: "/v1/a", count: 15, last: "" },
		{ status: 400, code: "BAD", path: "/v1/b", count: 4, last: "" },
		{ status: 400, code: "BAD", path: "/v1/c", count: 6, last: "" },
		{ status: 500, code: "INTERNAL", path: "/v1/d", count: 3, last: "" },
	];
	test("summary lists 4xx only, lowest status first, summing paths", () => {
		expect(errorSummary(errors)).toBe("10× 400 · 15× 404");
	});
	test("splits 4xx from 5xx", () => {
		expect(clientErrors(errors)).toHaveLength(3);
		expect(serverErrors(errors).map((e) => e.status)).toEqual([500]);
	});
	test("no 4xx gives an empty summary", () => {
		expect(errorSummary(serverErrors(errors))).toBe("");
	});
});

describe("shortenPath", () => {
	test("shortens long hex runs to 8 characters and an ellipsis", () => {
		const hex = "a".repeat(64);
		expect(shortenPath(`/v1/proofs/tx/${hex}`)).toBe("/v1/proofs/tx/aaaaaaaa…");
	});
	test("leaves short ids alone", () => {
		expect(shortenPath("/v1/proofs/writes/8942081")).toBe(
			"/v1/proofs/writes/8942081",
		);
	});
});

describe("hourlyPoints", () => {
	test("fills hours from midnight to now and sums sources", () => {
		const points = hourlyPoints(
			[
				{
					hour: "2026-10-15T01:00:00.000Z",
					source: "index",
					rows: 5,
					calls: 1,
				},
				{
					hour: "2026-10-15T01:00:00.000Z",
					source: "streams",
					rows: 2,
					calls: 1,
				},
				{
					hour: "2026-10-15T12:00:00.000Z",
					source: "index",
					rows: 9,
					calls: 1,
				},
			],
			NOW,
		);
		expect(points).toHaveLength(13);
		expect(points[1]).toBe(7);
		expect(points[12]).toBe(9);
		expect(points[0]).toBe(0);
	});
});
