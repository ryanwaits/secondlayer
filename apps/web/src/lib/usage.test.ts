import { describe, expect, test } from "bun:test";
import {
	ROWS_ALLOWANCE,
	accountCreationMonth,
	addMonths,
	allowanceFootLine,
	compareMonths,
	formatRows,
	formatUnitQuantity,
	monthLabel,
	monthParam,
	nextMonthLabel,
	spentUsdMicros,
	unitLabel,
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
