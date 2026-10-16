import { describe, expect, test } from "bun:test";
import {
	capChoice,
	capMeter,
	costByDay,
	creditDate,
	freeRowsUsedUpOn,
	monthProjection,
	monthSpendSeries,
	parseCapInput,
	totalMicros,
	unitLines,
} from "./billing-view";
import type { DailySpend } from "./usage";

const NOW = new Date("2026-10-10T12:00:00.000Z");

const day = (date: string, unit: string, micros: number): DailySpend => ({
	date,
	unit,
	usdMicros: String(micros),
});

describe("monthSpendSeries", () => {
	test("fills quiet days with zero and runs through today only", () => {
		const series = monthSpendSeries(
			[
				day("2026-10-01", "memory.gb_hour", 2_000_000),
				day("2026-10-03", "rows.delivered", 1_000_000),
			],
			NOW,
		);
		expect(series).toHaveLength(10);
		expect(series[0]).toBe(2);
		expect(series[1]).toBe(0);
		expect(series[2]).toBe(1);
	});

	test("leaves Sentinel runs out of the line", () => {
		const series = monthSpendSeries(
			[
				day("2026-10-02", "memory.gb_hour", 1_000_000),
				day("2026-10-02", "sentinel.run", 9_000_000),
			],
			NOW,
		);
		expect(series[1]).toBe(1);
	});

	test("ignores rows from another month", () => {
		const series = monthSpendSeries(
			[day("2026-09-30", "memory.gb_hour", 5_000_000)],
			NOW,
		);
		expect(series.every((v) => v === 0)).toBe(true);
	});
});

describe("monthProjection", () => {
	test("projects at the mean of the last 7 days", () => {
		const daily = Array.from({ length: 10 }, (_, i) =>
			day(
				`2026-10-${String(i + 1).padStart(2, "0")}`,
				"memory.gb_hour",
				1_000_000,
			),
		);
		const p = monthProjection(daily, NOW);
		expect(p.spent).toBe(10);
		expect(p.ratePerDay).toBe(1);
		expect(p.projectedEnd).toBe(31);
		expect(p.daysInMonth).toBe(31);
	});

	test("with fewer than 7 days of data, averages the days it has", () => {
		const early = new Date("2026-10-03T08:00:00.000Z");
		const p = monthProjection(
			[
				day("2026-10-01", "memory.gb_hour", 3_000_000),
				day("2026-10-02", "memory.gb_hour", 3_000_000),
				day("2026-10-03", "memory.gb_hour", 0),
			],
			early,
		);
		expect(p.ratePerDay).toBe(2);
		expect(p.projectedEnd).toBe(6 + 2 * 28);
	});
});

describe("costByDay", () => {
	test("splits a day into stack, rows, and events plus storage", () => {
		const days = costByDay(
			[
				day("2026-10-02", "memory.gb_hour", 1_000_000),
				day("2026-10-02", "rows.delivered", 2_000_000),
				day("2026-10-02", "webhook.event", 300_000),
				day("2026-10-02", "storage.gb_day", 200_000),
				day("2026-10-02", "sentinel.run", 4_000_000),
			],
			NOW,
		);
		expect(days).toHaveLength(10);
		expect(days[1]).toEqual({
			day: "Oct 2",
			stack: 1,
			rows: 2,
			events: 0.5,
		});
	});
});

describe("freeRowsUsedUpOn", () => {
	test("is the first day rows were billed", () => {
		expect(
			freeRowsUsedUpOn(
				[
					day("2026-10-08", "rows.delivered", 40),
					day("2026-10-06", "rows.delivered", 10),
				],
				NOW,
			),
		).toBe("Oct 6");
	});

	test("is null when no rows were billed", () => {
		expect(freeRowsUsedUpOn([], NOW)).toBeNull();
	});
});

describe("capMeter", () => {
	const base = {
		spentUsd: 6.21,
		projectedEndUsd: 12.28,
		deliveredRows: 0,
		usedUpOn: null,
		now: NOW,
	};

	test("a cap above the projection reads spend against it", () => {
		const m = capMeter({ ...base, capUsd: 40 });
		expect(m.left).toBe("$6.21 of $40 this month");
		expect(m.right).toBe("$12.28 at this pace");
		expect(m.total).toBe(40);
	});

	test("a projection over the cap says when it hits", () => {
		const m = capMeter({ ...base, capUsd: 10 });
		expect(m.right).toBe("hits the cap before Nov 1");
	});

	test("no cap shows the free rows used up", () => {
		const m = capMeter({
			...base,
			capUsd: null,
			deliveredRows: 3_000_000,
			usedUpOn: "Oct 6",
		});
		expect(m.left).toBe("Free rows · used up Oct 6");
		expect(m.right).toBe("resets Nov 1");
		expect(m.used).toBe(1_000_000);
	});

	test("no cap with rows left shows how many are used", () => {
		const m = capMeter({ ...base, capUsd: null, deliveredRows: 250_000 });
		expect(m.left).toBe("Free rows · 250,000 of 1M used");
	});
});

describe("parseCapInput", () => {
	test("accepts whole dollars above zero", () => {
		expect(parseCapInput("40")).toBe(40);
		expect(parseCapInput(" 7 ")).toBe(7);
	});

	test("clears to none for zero, text, and fractions", () => {
		expect(parseCapInput("0")).toBeNull();
		expect(parseCapInput("abc")).toBeNull();
		expect(parseCapInput("12.5")).toBeNull();
		expect(parseCapInput("")).toBeNull();
		expect(parseCapInput("-5")).toBeNull();
	});
});

describe("capChoice", () => {
	test("maps a cap to its segment", () => {
		expect(capChoice(null)).toBe("none");
		expect(capChoice(25)).toBe("25");
		expect(capChoice(40)).toBe("other");
	});
});

describe("unitLines", () => {
	test("drops top-ups and grants and puts Sentinel last", () => {
		const lines = unitLines([
			{ unit: "sentinel.run", quantity: "17", usdMicros: "25500000" },
			{ unit: "topup", quantity: "2", usdMicros: "-30000000" },
			{ unit: "grant", quantity: "5", usdMicros: "-5000000" },
			{ unit: "rows.delivered", quantity: "900", usdMicros: "0" },
		]);
		expect(lines.map((l) => l.unit)).toEqual([
			"rows.delivered",
			"sentinel.run",
		]);
		expect(lines[1]?.sentinel).toBe(true);
	});

	test("totals micros without losing precision", () => {
		expect(
			totalMicros([{ usdMicros: "9007199254740993" }, { usdMicros: "7" }]),
		).toBe("9007199254741000");
	});
});

describe("creditDate", () => {
	test("is month and day in UTC", () => {
		expect(creditDate("2026-10-09T23:59:00.000Z")).toBe("10-09");
	});
});
