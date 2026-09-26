import { describe, expect, test } from "bun:test";
import {
	ROWS_ALLOWANCE,
	accountCreationMonth,
	addMonths,
	allowanceFootLine,
	allowanceUsedFraction,
	compareMonths,
	deliveredRowsIn,
	formatRows,
	formatUnitQuantity,
	monthLabel,
	monthParam,
	nextMonthLabel,
	runwayDays,
	spentUsdMicros,
	unitLabel,
	utcDaysElapsedInMonth,
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

	test("GB units keep up to 2 fractional decimals", () => {
		expect(formatUnitQuantity("memory.gb_hour", "12.5")).toBe("12.5");
		expect(formatUnitQuantity("storage.gb_day", "3")).toBe("3");
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
			"Delivery service memory",
			"Hosted webhooks",
		]);
		expect(unitLabel("storage.gb_day")).toEqual([
			"Delivery service storage",
			"Hosted webhooks",
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
		expect(allowanceFootLine(4_000_000, resetLabel)).toBe(
			"6M free rows left. Resets Oct 1.",
		);
	});

	test("exactly at the allowance", () => {
		expect(allowanceFootLine(ROWS_ALLOWANCE, resetLabel)).toBe(
			"Allowance used. Resets Oct 1.",
		);
	});

	test("over the allowance", () => {
		expect(allowanceFootLine(10_410_000, resetLabel)).toBe(
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

describe("allowanceUsedFraction", () => {
	test("0 rows is 0, the full allowance is 1, and past it exceeds 1", () => {
		expect(allowanceUsedFraction(0)).toBe(0);
		expect(allowanceUsedFraction(ROWS_ALLOWANCE)).toBe(1);
		expect(allowanceUsedFraction(ROWS_ALLOWANCE * 1.5)).toBe(1.5);
	});
});

describe("utcDaysElapsedInMonth", () => {
	test("is the UTC day-of-month, at least 1 on the 1st", () => {
		expect(utcDaysElapsedInMonth(new Date("2026-09-01T00:00:00.000Z"))).toBe(1);
		expect(utcDaysElapsedInMonth(new Date("2026-09-15T23:00:00.000Z"))).toBe(
			15,
		);
	});
});

describe("runwayDays", () => {
	test("projects balance / (spend so far / days elapsed)", () => {
		// $50 balance, $10 spent in 5 days → $2/day → 25 days of runway.
		expect(runwayDays(50_000_000, 10_000_000, 5)).toBe(25);
	});

	test("is null with zero balance", () => {
		expect(runwayDays(0, 10_000_000, 5)).toBeNull();
	});

	test("is null with zero spend (nothing to project a rate from)", () => {
		expect(runwayDays(50_000_000, 0, 5)).toBeNull();
	});

	test("is null at month start (0 days elapsed) instead of dividing by zero", () => {
		expect(runwayDays(50_000_000, 10_000_000, 0)).toBeNull();
	});

	test("still projects on day 1 of the month (1 day elapsed, not 0)", () => {
		expect(runwayDays(10_000_000, 10_000_000, 1)).toBe(1);
	});
});
