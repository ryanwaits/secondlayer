import { describe, expect, test } from "bun:test";
import {
	ROWS_ALLOWANCE,
	addMonths,
	balanceLevel,
	daysInUtcMonth,
	deliveredRowsIn,
	formatRows,
	formatUnitQuantity,
	latestMemoryHour,
	monthLabel,
	monthParam,
	nextMonthLabel,
	rateLabel,
	runsOutMonth,
	runwayDays,
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

describe("daysInUtcMonth", () => {
	test("September has 30 days", () => {
		expect(daysInUtcMonth({ year: 2026, month: 8 })).toBe(30);
	});

	test("February in a non-leap year has 28", () => {
		expect(daysInUtcMonth({ year: 2026, month: 1 })).toBe(28);
	});
});

describe("runsOutMonth", () => {
	const now = new Date("2026-10-16T12:00:00Z");

	test("names the UTC month the balance runs out", () => {
		expect(runsOutMonth(53_060_000, 146_100, now)).toBe("Oct 2027");
	});

	test("null when nothing burns", () => {
		expect(runsOutMonth(53_060_000, 0, now)).toBeNull();
	});

	test("an empty balance runs out this month", () => {
		expect(runsOutMonth(0, 146_100, now)).toBe("Oct 2026");
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

	test("Sentinel units carry their per-unit rate", () => {
		expect(rateLabel("sentinel.run", "17")).toBe("$1.50/run");
		expect(rateLabel("sentinel.deep_audit", "1")).toBe("$3/audit");
		expect(rateLabel("sentinel.monitored_event", "1")).toBe("$15/1M");
		expect(unitLabel("sentinel.run")[0]).toBe("Sentinel runs");
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

const WEBHOOK_FLOOR = { usd: 5, gb: 5 / (730 * 0.028) };
const hour = (billedGb: number, observedGb: number | null) => ({
	hour: "2026-10-15T12:00:00.000Z",
	billedGb,
	observedGb,
});
