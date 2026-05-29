import { describe, expect, test } from "bun:test";
import {
	DEFAULT_BTC_CONFIRMATIONS,
	finalizedBurnHeight,
} from "../src/finality.ts";

describe("finalizedBurnHeight", () => {
	test("subtracts the default confirmation window from the burn tip", () => {
		expect(finalizedBurnHeight(871_249)).toBe(
			871_249 - DEFAULT_BTC_CONFIRMATIONS,
		);
	});

	test("honors an explicit confirmation count", () => {
		expect(finalizedBurnHeight(100, 3)).toBe(97);
	});

	test("clamps to 0 when the chain is shorter than the window", () => {
		expect(finalizedBurnHeight(4, 6)).toBe(0);
		expect(finalizedBurnHeight(0)).toBe(0);
	});

	test("treats 0 confirmations as the burn tip itself", () => {
		expect(finalizedBurnHeight(500, 0)).toBe(500);
	});

	test("rejects non-integer or negative inputs", () => {
		expect(() => finalizedBurnHeight(-1)).toThrow();
		expect(() => finalizedBurnHeight(10.5)).toThrow();
		expect(() => finalizedBurnHeight(10, -2)).toThrow();
		expect(() => finalizedBurnHeight(10, 1.5)).toThrow();
	});
});
