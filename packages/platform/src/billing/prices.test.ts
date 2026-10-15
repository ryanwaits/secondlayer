import { describe, expect, test } from "bun:test";
import {
	HOURS_PER_MONTH,
	PRICES,
	STACK_FLOOR_USD_MICROS_PER_MONTH,
	stackMemoryFloorGb,
} from "./prices.ts";

/** What a month at the floor bills: `meter()` prices each hourly memory row
 *  as `round(rate × GB-hours)`, so the rounding happens per hour. */
function monthAtFloorUsdMicros(hasSubgraphs: boolean): number {
	const perHour = Math.round(
		Number(PRICES["memory.gb_hour"]) * stackMemoryFloorGb(hasSubgraphs),
	);
	return perHour * HOURS_PER_MONTH;
}

const ONE_CENT_MICROS = 10_000;

describe("stack floor", () => {
	test("the webhook-only floor bills $5.00 over a 730-hour month within 1¢", () => {
		const billed = monthAtFloorUsdMicros(false);
		expect(
			Math.abs(billed - Number(STACK_FLOOR_USD_MICROS_PER_MONTH.webhooks)),
		).toBeLessThan(ONE_CENT_MICROS);
		expect(billed).toBe(6_849 * 730);
	});

	test("the floor with subgraphs bills $10.00 over a 730-hour month within 1¢", () => {
		const billed = monthAtFloorUsdMicros(true);
		expect(
			Math.abs(billed - Number(STACK_FLOOR_USD_MICROS_PER_MONTH.subgraphs)),
		).toBeLessThan(ONE_CENT_MICROS);
	});

	test("the memory floor is derived from the dollar floor, not set in GB", () => {
		expect(stackMemoryFloorGb(false)).toBeCloseTo(0.24462, 5);
		expect(stackMemoryFloorGb(true)).toBeCloseTo(0.48924, 5);
	});
});
