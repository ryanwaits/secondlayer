import { describe, expect, test } from "bun:test";
import { isOverMonthlyCreditCap } from "./read-credits.ts";

describe("isOverMonthlyCreditCap", () => {
	test("no cap (null) is never over", () => {
		expect(isOverMonthlyCreditCap(0n, null)).toBe(false);
		expect(isOverMonthlyCreditCap(999_999_999n, null)).toBe(false);
	});

	test("under the cap → not over", () => {
		// $5.00 cap = 500¢ = 5_000_000 µ$. Spent $4.99.
		expect(isOverMonthlyCreditCap(4_990_000n, 500)).toBe(false);
	});

	test("exactly at the cap → over (freeze on reach, inclusive)", () => {
		expect(isOverMonthlyCreditCap(5_000_000n, 500)).toBe(true);
	});

	test("over the cap → over", () => {
		expect(isOverMonthlyCreditCap(5_000_001n, 500)).toBe(true);
	});

	test("zero cap freezes immediately on any spend", () => {
		expect(isOverMonthlyCreditCap(0n, 0)).toBe(true);
		expect(isOverMonthlyCreditCap(1n, 0)).toBe(true);
	});

	test("cents→micros conversion is 10_000× (1¢ = 10_000 µ$)", () => {
		// 1¢ cap = 10_000 µ$. Spending 9_999 µ$ is under; 10_000 is at.
		expect(isOverMonthlyCreditCap(9_999n, 1)).toBe(false);
		expect(isOverMonthlyCreditCap(10_000n, 1)).toBe(true);
	});
});
