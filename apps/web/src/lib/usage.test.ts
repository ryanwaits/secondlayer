import { describe, expect, test } from "bun:test";
import {
	ROWS_ALLOWANCE,
	accountCreationMonth,
	addMonths,
	allowanceFootLine,
	balanceLevel,
	buildDailyChart,
	burnCompositionLabel,
	compareMonths,
	dailyChartNowReferenceDate,
	dailyChartXTickFormatter,
	dailyChartXTicks,
	dailyChartYAxis,
	daysInUtcMonth,
	deliveredRowsIn,
	formatDailyChartYTick,
	formatMemoryChartYTick,
	formatRows,
	formatUnitQuantity,
	formatUsdPerHour,
	fractionalDaysRemainingInMonth,
	latestMemoryHour,
	memoryChartXTickFormatter,
	memoryChartYTicks,
	memoryMinimumLabel,
	monthLabel,
	monthParam,
	nextChargeLabel,
	nextMonthAtRateUsdMicros,
	nextMonthLabel,
	packDaysLabel,
	projectedMonthEndUsdMicros,
	rateLabel,
	runsOutDate,
	runwayDays,
	spentUsdMicros,
	toDailyChartRows,
	toMemoryChartPoints,
	unitLabel,
	withUsageMonth,
} from "./usage";

describe("formatRows", () => {
	test("rows at or above 1M format with a trimmed M suffix", () => {
		expect(formatRows(6_410_000)).toBe("6.41M");
		expect(formatRows(10_000_000)).toBe("10M");
		expect(formatRows(1_500_000)).toBe("1.5M");
		expect(formatRows(1_000_000)).toBe("1M");
	});

	test("rows below 1M use thousands separators", () => {
		expect(formatRows(999_999)).toBe("999,999");
		expect(formatRows(1_234)).toBe("1,234");
		expect(formatRows(0)).toBe("0");
	});

	test("accepts a string quantity, matching the API's bigint-as-string shape", () => {
		expect(formatRows("17840112")).toBe("17.84M");
	});
});

describe("formatUnitQuantity", () => {
	test("rows.delivered goes through formatRows", () => {
		expect(formatUnitQuantity("rows.delivered", "6410000")).toBe("6.41M");
	});

	test("GB-hour/GB-day units carry their unit suffix, one decimal", () => {
		expect(formatUnitQuantity("memory.gb_hour", "12.5")).toBe("12.5 GB-h");
		expect(formatUnitQuantity("storage.gb_day", "3")).toBe("3.0 GB-d");
	});

	test("everything else is a thousands-separated whole count", () => {
		expect(formatUnitQuantity("archive.partition", "12")).toBe("12");
		expect(formatUnitQuantity("webhook.event", "184213")).toBe("184,213");
	});
});

describe("unitLabel", () => {
	test("labels the three hosted units (044)", () => {
		expect(unitLabel("webhook.event")).toEqual([
			"Webhook events",
			"Hosted webhooks, retries free",
		]);
		expect(unitLabel("memory.gb_hour")).toEqual([
			"Hosted stack memory",
			"Webhooks and subgraphs",
		]);
		expect(unitLabel("storage.gb_day")).toEqual([
			"Hosted stack storage",
			"Webhooks and subgraphs",
		]);
	});

	test("falls back to the raw unit name with no sub-line", () => {
		expect(unitLabel("some.future.unit")).toEqual(["some.future.unit", ""]);
	});
});

describe("spentUsdMicros", () => {
	test("sums positive usdMicros and excludes top-ups", () => {
		const usage = [
			{ unit: "rows.delivered", quantity: "17840112", usdMicros: "39200560" },
			{ unit: "archive.partition", quantity: "12", usdMicros: "600000" },
			{ unit: "topup", quantity: "2", usdMicros: "-75000000" },
		];
		expect(spentUsdMicros(usage)).toBe(39_800_560);
	});

	test("a month with only a top-up spends nothing", () => {
		expect(
			spentUsdMicros([
				{ unit: "topup", quantity: "1", usdMicros: "-25000000" },
			]),
		).toBe(0);
	});
});

describe("allowanceFootLine", () => {
	const resetLabel = "Oct 1";

	test("under the allowance", () => {
		expect(allowanceFootLine(400_000, resetLabel)).toBe(
			"600,000 free rows left. Resets Oct 1.",
		);
	});

	test("exactly at the allowance", () => {
		expect(allowanceFootLine(ROWS_ALLOWANCE, resetLabel)).toBe(
			"Allowance used. Resets Oct 1.",
		);
	});

	test("over the allowance", () => {
		expect(allowanceFootLine(1_410_000, resetLabel)).toBe(
			"Allowance used. 410,000 rows past it this month, paid from your balance. Resets Oct 1.",
		);
	});
});

describe("month math", () => {
	test("addMonths wraps across year boundaries", () => {
		expect(addMonths({ year: 2026, month: 11 }, 1)).toEqual({
			year: 2027,
			month: 0,
		});
		expect(addMonths({ year: 2026, month: 0 }, -1)).toEqual({
			year: 2025,
			month: 11,
		});
	});

	test("monthParam pads the month to two digits", () => {
		expect(monthParam({ year: 2026, month: 8 })).toBe("2026-09");
		expect(monthParam({ year: 2026, month: 11 })).toBe("2026-12");
	});

	test("monthLabel and nextMonthLabel", () => {
		expect(monthLabel({ year: 2026, month: 8 })).toBe("September 2026");
		expect(nextMonthLabel({ year: 2026, month: 8 })).toBe("Oct 1");
	});

	test("compareMonths orders across years", () => {
		expect(
			compareMonths({ year: 2026, month: 0 }, { year: 2025, month: 11 }),
		).toBe(1);
		expect(
			compareMonths({ year: 2026, month: 5 }, { year: 2026, month: 5 }),
		).toBe(0);
		expect(
			compareMonths({ year: 2025, month: 11 }, { year: 2026, month: 0 }),
		).toBe(-1);
	});
});

describe("accountCreationMonth", () => {
	test("reads the UTC month from an ISO date", () => {
		expect(accountCreationMonth("2026-03-15T10:00:00.000Z")).toEqual({
			year: 2026,
			month: 2,
		});
	});

	test("null for missing or unparseable input", () => {
		expect(accountCreationMonth(null)).toBeNull();
		expect(accountCreationMonth(undefined)).toBeNull();
		expect(accountCreationMonth("not-a-date")).toBeNull();
	});
});

describe("withUsageMonth", () => {
	test("writes only the given month, leaving other months untouched", () => {
		const before = {
			"2026-08": [{ unit: "rows.delivered", quantity: "1", usdMicros: "5" }],
		};
		const after = withUsageMonth(before, "2026-09", [
			{ unit: "rows.delivered", quantity: "2", usdMicros: "10" },
		]);
		expect(after["2026-08"]).toBe(before["2026-08"]);
		expect(after["2026-09"]).toEqual([
			{ unit: "rows.delivered", quantity: "2", usdMicros: "10" },
		]);
	});

	test("a late response for month A does not change month B's entry", () => {
		// Simulates clicking the month switcher twice fast: the August fetch
		// (still in flight) resolves after the September fetch already landed.
		const septFirst = withUsageMonth({}, "2026-09", [
			{ unit: "rows.delivered", quantity: "9", usdMicros: "45" },
		]);
		const augLate = withUsageMonth(septFirst, "2026-08", [
			{ unit: "rows.delivered", quantity: "8", usdMicros: "40" },
		]);
		expect(augLate["2026-09"]).toEqual([
			{ unit: "rows.delivered", quantity: "9", usdMicros: "45" },
		]);
		expect(augLate["2026-08"]).toEqual([
			{ unit: "rows.delivered", quantity: "8", usdMicros: "40" },
		]);
	});

	test("does not mutate the previous map", () => {
		const before = { "2026-09": [] };
		withUsageMonth(before, "2026-08", []);
		expect(before).toEqual({ "2026-09": [] });
	});
});

describe("deliveredRowsIn", () => {
	test("reads the rows.delivered quantity", () => {
		expect(
			deliveredRowsIn([
				{ unit: "rows.delivered", quantity: "500", usdMicros: "0" },
			]),
		).toBe(500);
	});

	test("is 0 when the unit hasn't billed anything this month", () => {
		expect(deliveredRowsIn([])).toBe(0);
		expect(
			deliveredRowsIn([
				{ unit: "webhook.event", quantity: "3", usdMicros: "10" },
			]),
		).toBe(0);
	});
});

describe("runwayDays", () => {
	test("balance / rateDay", () => {
		expect(runwayDays(50_000_000, 10_000_000)).toBe(5);
	});

	test("is Infinity when rateDay is zero — nothing burning, nothing to run out", () => {
		expect(runwayDays(50_000_000, 0)).toBe(Number.POSITIVE_INFINITY);
	});

	test("is Infinity for a negative rate too (never billed backwards)", () => {
		expect(runwayDays(50_000_000, -1)).toBe(Number.POSITIVE_INFINITY);
	});
});

describe("balanceLevel", () => {
	test("ok above 7 days of runway", () => {
		expect(
			balanceLevel({
				serviceState: "running",
				balanceUsdMicros: 1,
				runwayDays: 8,
			}),
		).toBe("ok");
	});

	test("ok with no service and no spend (Infinity runway)", () => {
		expect(
			balanceLevel({
				serviceState: "none",
				balanceUsdMicros: 0,
				runwayDays: Number.POSITIVE_INFINITY,
			}),
		).toBe("ok");
	});

	test("low at 7 days, not yet low at 7.01", () => {
		expect(
			balanceLevel({
				serviceState: "running",
				balanceUsdMicros: 1,
				runwayDays: 7,
			}),
		).toBe("low");
		expect(
			balanceLevel({
				serviceState: "running",
				balanceUsdMicros: 1,
				runwayDays: 7.01,
			}),
		).toBe("ok");
	});

	test("crit at 2 days, not yet crit at 2.01", () => {
		expect(
			balanceLevel({
				serviceState: "running",
				balanceUsdMicros: 1,
				runwayDays: 2,
			}),
		).toBe("crit");
		expect(
			balanceLevel({
				serviceState: "running",
				balanceUsdMicros: 1,
				runwayDays: 2.01,
			}),
		).toBe("low");
	});

	test("stopped overrides runway when the service is stopped at $0", () => {
		expect(
			balanceLevel({
				serviceState: "stopped",
				balanceUsdMicros: 0,
				runwayDays: Number.POSITIVE_INFINITY,
			}),
		).toBe("stopped");
	});

	test("a stopped service with a positive balance is not `stopped`", () => {
		expect(
			balanceLevel({
				serviceState: "stopped",
				balanceUsdMicros: 1,
				runwayDays: 3,
			}),
		).toBe("low");
	});
});

describe("runsOutDate", () => {
	test("now + runway days, UTC, Mon D", () => {
		expect(runsOutDate(new Date("2026-09-28T17:05:00.000Z"), 24)).toBe(
			"Oct 22",
		);
	});
});

describe("daysInUtcMonth / fractionalDaysRemainingInMonth", () => {
	test("September has 30 days", () => {
		expect(daysInUtcMonth({ year: 2026, month: 8 })).toBe(30);
	});

	test("February in a non-leap year has 28", () => {
		expect(daysInUtcMonth({ year: 2026, month: 1 })).toBe(28);
	});

	test("mid-month, mid-day leaves a fractional remainder", () => {
		// Sep 28, 17:05 UTC of a 30-day month → 30 - 27.2118... ≈ 2.288 days left.
		const remaining = fractionalDaysRemainingInMonth(
			new Date("2026-09-28T17:05:00.000Z"),
		);
		expect(remaining).toBeCloseTo(2.2882, 3);
	});

	test("first instant of the month leaves the full month", () => {
		expect(
			fractionalDaysRemainingInMonth(new Date("2026-09-01T00:00:00.000Z")),
		).toBe(30);
	});
});

describe("projectedMonthEndUsdMicros / nextMonthAtRateUsdMicros", () => {
	test("month-to-date spend + rateDay x remaining fractional days", () => {
		expect(projectedMonthEndUsdMicros(3_840_000, 350_000, 2)).toBe(4_540_000);
	});

	test("rateDay x days in next month", () => {
		expect(nextMonthAtRateUsdMicros(350_000, { year: 2026, month: 8 })).toBe(
			350_000 * 31, // October has 31 days
		);
	});
});

describe("packDaysLabel", () => {
	test("stopped always says the pack restarts the service", () => {
		expect(packDaysLabel(25, 350_000, true)).toBe("starts your service again");
		expect(packDaysLabel(25, 0, true)).toBe("starts your service again");
	});

	test("about N days at a real rate", () => {
		// $25 pack at $0.35/day (350,000µ$) → floor(25,000,000/350,000) = 71 days.
		expect(packDaysLabel(25, 350_000, false)).toBe(
			"about 71 days at this rate",
		);
	});

	test("over a year once the pack would outlast 365 days", () => {
		// $100 pack at $0.10/day → 1000 days.
		expect(packDaysLabel(100, 100_000, false)).toBe("over a year at this rate");
	});

	test("no burn at all (not stopped) reads as a very long runway", () => {
		expect(packDaysLabel(25, 0, false)).toBe("over a year at this rate");
	});
});

describe("nextChargeLabel", () => {
	test("running shows the next full-hour memory charge", () => {
		expect(
			nextChargeLabel(new Date("2026-09-28T17:05:00.000Z"), "running"),
		).toBe("Updated 17:05 UTC · next memory charge 18:00");
	});

	test("wraps midnight", () => {
		expect(
			nextChargeLabel(new Date("2026-09-28T23:40:00.000Z"), "running"),
		).toBe("Updated 23:40 UTC · next memory charge 00:00");
	});

	test("stopped or none both read as service stopped", () => {
		expect(
			nextChargeLabel(new Date("2026-09-28T17:05:00.000Z"), "stopped"),
		).toBe("Updated 17:05 UTC · service stopped");
		expect(nextChargeLabel(new Date("2026-09-28T17:05:00.000Z"), "none")).toBe(
			"Updated 17:05 UTC · service stopped",
		);
	});
});

describe("formatUsdPerHour", () => {
	test("3 decimals, from a daily rate", () => {
		// $0.336/day (memDay for 0.5 GB-h x $0.028) / 24 = $0.014/hour.
		expect(formatUsdPerHour(336_000)).toBe("$0.014");
	});
});

describe("burnCompositionLabel", () => {
	test("stopped reads as no composition (caller shows its own copy)", () => {
		expect(burnCompositionLabel(false, undefined)).toBe("");
	});

	test("running with no other spend is just memory", () => {
		expect(burnCompositionLabel(true, [])).toBe("memory");
	});

	test("adds events and rows only when this month actually spent on them", () => {
		const rows = [
			{ unit: "memory.gb_hour", quantity: "12", usdMicros: "336000" },
			{ unit: "webhook.event", quantity: "1200", usdMicros: "12000" },
			{ unit: "rows.delivered", quantity: "0", usdMicros: "0" },
		];
		expect(burnCompositionLabel(true, rows)).toBe("memory + events");
	});

	test("all three when memory, events and rows all spent", () => {
		const rows = [
			{ unit: "webhook.event", quantity: "1200", usdMicros: "12000" },
			{ unit: "rows.delivered", quantity: "150000", usdMicros: "750000" },
		];
		expect(burnCompositionLabel(true, rows)).toBe("memory + events + rows");
	});
});

describe("latestMemoryHour", () => {
	test("the last (most recent) row", () => {
		const rows = [
			{ hour: "2026-09-28T10:00:00.000Z", billedGb: 0.5, observedGb: 0.3 },
			{ hour: "2026-09-28T11:00:00.000Z", billedGb: 0.5, observedGb: 0.31 },
		];
		expect(latestMemoryHour(rows)).toBe(rows[1]);
	});

	test("null for no history", () => {
		expect(latestMemoryHour([])).toBeNull();
	});
});

describe("rateLabel", () => {
	test("flat rates", () => {
		expect(rateLabel("memory.gb_hour", "1")).toBe("$0.028/GB-h");
		expect(rateLabel("webhook.event", "1")).toBe("$10/1M");
		expect(rateLabel("storage.gb_day", "1")).toBe("$0.25/GB-mo");
		expect(rateLabel("archive.partition", "1")).toBe("$0.05/partition");
		expect(rateLabel("archive.partition.events", "1")).toBe("$0.15/partition");
	});

	test("rows.delivered is free inside the allowance, $5/1M past it", () => {
		expect(rateLabel("rows.delivered", "17171")).toBe("free");
		expect(rateLabel("rows.delivered", String(ROWS_ALLOWANCE + 1))).toBe(
			"$5/1M",
		);
	});

	test("unknown unit has no rate label", () => {
		expect(rateLabel("topup", "1")).toBe("");
	});
});

describe("buildDailyChart", () => {
	const month = { year: 2026, month: 8 }; // September

	test("splits daily rows into memory/events/rows buckets by day", () => {
		const daily = [
			{ date: "2026-09-01", unit: "memory.gb_hour", usdMicros: "14000" },
			{ date: "2026-09-01", unit: "webhook.event", usdMicros: "12000" },
			{ date: "2026-09-02", unit: "rows.delivered", usdMicros: "5000" },
		];
		const now = new Date("2026-09-30T23:59:59.000Z"); // whole month is "past"
		const days = buildDailyChart(daily, month, now, 0);
		expect(days).toHaveLength(30);
		expect(days[0]).toEqual({
			day: 1,
			date: "2026-09-01",
			memUsdMicros: 14000,
			eventsUsdMicros: 12000,
			rowsUsdMicros: 0,
			projected: false,
		});
		expect(days[1]?.rowsUsdMicros).toBe(5000);
		expect(days.every((d) => !d.projected)).toBe(true);
	});

	test("days after today are projected and carry no real category data", () => {
		const now = new Date("2026-09-05T12:00:00.000Z");
		const days = buildDailyChart([], month, now, 350_000);
		const today = days.find((d) => d.day === 5);
		const tomorrow = days.find((d) => d.day === 6);
		expect(today?.projected).toBe(false);
		expect(tomorrow?.projected).toBe(true);
		expect(tomorrow?.memUsdMicros).toBe(0);
	});

	test("a past month (not now's month) has no projected days", () => {
		const now = new Date("2026-10-15T12:00:00.000Z");
		const days = buildDailyChart([], month, now, 350_000);
		expect(days.every((d) => !d.projected)).toBe(true);
		expect(days).toHaveLength(30);
	});
});

describe("toDailyChartRows", () => {
	test("a real day carries its three categories, projectedUsd at 0", () => {
		const days = [
			{
				day: 1,
				date: "2026-09-01",
				memUsdMicros: 14_000,
				eventsUsdMicros: 12_000,
				rowsUsdMicros: 5_000,
				projected: false,
			},
		];
		expect(toDailyChartRows(days, 350_000)).toEqual([
			{
				date: "2026-09-01",
				day: 1,
				memUsd: 0.014,
				eventsUsd: 0.012,
				rowsUsd: 0.005,
				projectedUsd: 0,
			},
		]);
	});

	test("a projected day carries only projectedUsd (the day's full rate), the rest at 0", () => {
		const days = [
			{
				day: 6,
				date: "2026-09-06",
				memUsdMicros: 0,
				eventsUsdMicros: 0,
				rowsUsdMicros: 0,
				projected: true,
			},
		];
		expect(toDailyChartRows(days, 350_000)).toEqual([
			{
				date: "2026-09-06",
				day: 6,
				memUsd: 0,
				eventsUsd: 0,
				rowsUsd: 0,
				projectedUsd: 0.35,
			},
		]);
	});
});

describe("dailyChartXTicks / dailyChartXTickFormatter / dailyChartNowReferenceDate", () => {
	const month = { year: 2026, month: 8 };

	test("ticks at day 1, every 7th day before today, and the last day", () => {
		const now = new Date("2026-09-20T12:00:00.000Z");
		const days = buildDailyChart([], month, now, 0);
		const ticks = dailyChartXTicks(days, now.getUTCDate());
		expect(ticks).toEqual([
			"2026-09-01",
			"2026-09-07",
			"2026-09-14",
			"2026-09-30",
		]);
	});

	test("formats a date to '<Month short> <day>'", () => {
		expect(dailyChartXTickFormatter("Sep")("2026-09-07")).toBe("Sep 7");
	});

	test("the now-reference date is the first projected day", () => {
		const now = new Date("2026-09-20T12:00:00.000Z");
		const days = buildDailyChart([], month, now, 350_000);
		expect(dailyChartNowReferenceDate(days)).toBe("2026-09-21");
	});

	test("null when nothing is projected (a fully-past month)", () => {
		const now = new Date("2026-10-15T12:00:00.000Z");
		const days = buildDailyChart([], month, now, 350_000);
		expect(dailyChartNowReferenceDate(days)).toBeNull();
	});
});

describe("dailyChartYAxis / formatDailyChartYTick", () => {
	test("a quiet month uses the finest ($0.10) step, 2 decimals", () => {
		const rows = [
			{
				date: "2026-09-01",
				day: 1,
				memUsd: 0.1,
				eventsUsd: 0,
				rowsUsd: 0,
				projectedUsd: 0,
			},
		];
		const axis = dailyChartYAxis(rows);
		expect(axis.decimals).toBe(2);
		expect(axis.ticks[0]).toBe(0);
		expect(formatDailyChartYTick(0.1, axis.decimals)).toBe("$0.10");
	});

	test("a big-spend day uses the coarsest ($2) step, whole dollars", () => {
		const rows = [
			{
				date: "2026-09-01",
				day: 1,
				memUsd: 5,
				eventsUsd: 0,
				rowsUsd: 0,
				projectedUsd: 0,
			},
		];
		const axis = dailyChartYAxis(rows);
		expect(axis.decimals).toBe(0);
		expect(formatDailyChartYTick(2, axis.decimals)).toBe("$2");
	});
});

describe("toMemoryChartPoints", () => {
	test("maps hours-ago to an x position from 0 (24h ago) to 24 (now)", () => {
		const now = new Date("2026-09-28T12:00:00.000Z");
		const points = toMemoryChartPoints(
			[
				{ hour: "2026-09-27T12:00:00.000Z", billedGb: 0.5, observedGb: 0.3 },
				{ hour: "2026-09-28T12:00:00.000Z", billedGb: 0.5, observedGb: 0.32 },
			],
			now,
		);
		expect(points[0]?.x).toBeCloseTo(0, 6);
		expect(points[1]?.x).toBeCloseTo(24, 6);
	});

	test("value falls back to billedGb when observedGb is null; areaValue stays null", () => {
		const now = new Date("2026-09-28T12:00:00.000Z");
		const points = toMemoryChartPoints(
			[{ hour: "2026-09-28T12:00:00.000Z", billedGb: 0.5, observedGb: null }],
			now,
		);
		expect(points[0]?.value).toBe(0.5);
		expect(points[0]?.areaValue).toBeNull();
		expect(points[0]?.billedGb).toBe(0.5);
	});

	test("returns two zero-value boundary points when there's no history in the window, so the chart frame still renders", () => {
		const now = new Date("2026-09-28T12:00:00.000Z");
		const points = toMemoryChartPoints([], now);
		expect(points).toHaveLength(2);
		expect(points[0]).toMatchObject({
			x: 0,
			value: 0,
			areaValue: null,
			billedGb: 0,
		});
		expect(points[1]).toMatchObject({
			x: 24,
			value: 0,
			areaValue: null,
			billedGb: 0,
		});
	});
});

describe("memoryChartYTicks / formatMemoryChartYTick", () => {
	test("three ticks: 0, half, and a peak with headroom above the sample", () => {
		const ticks = memoryChartYTicks([
			{ hour: "2026-09-28T12:00:00.000Z", billedGb: 0.5, observedGb: 0.3 },
		]);
		expect(ticks).toHaveLength(3);
		expect(ticks[0]).toBe(0);
		expect(ticks[2]).toBeGreaterThan(0.3);
	});

	test("strips one trailing zero, matching the locked mock's own gridline format", () => {
		expect(formatMemoryChartYTick(1)).toBe("1.0 GB");
		expect(formatMemoryChartYTick(0.5)).toBe("0.5 GB");
	});
});

describe("memoryChartXTickFormatter", () => {
	test("0 is '24h ago', 12 is '12h', 24 is 'now'", () => {
		expect(memoryChartXTickFormatter(0)).toBe("24h ago");
		expect(memoryChartXTickFormatter(12)).toBe("12h");
		expect(memoryChartXTickFormatter(24)).toBe("now");
	});
});

describe("memoryMinimumLabel", () => {
	test("running and under the floor: labeled billed", () => {
		expect(memoryMinimumLabel(true, 0.3)).toBe("0.5 GB minimum (billed)");
	});

	test("running and at/above the floor: no billed suffix", () => {
		expect(memoryMinimumLabel(true, 0.8)).toBe("0.5 GB minimum");
	});

	test("stopped never claims billed, even if the last sample was under the floor", () => {
		expect(memoryMinimumLabel(false, 0.3)).toBe("0.5 GB minimum");
	});

	test("no observed sample at all: no billed suffix", () => {
		expect(memoryMinimumLabel(true, null)).toBe("0.5 GB minimum");
	});
});
