import { describe, expect, test } from "bun:test";
import { ValidationError } from "@secondlayer/shared/errors";
import { clampLimit, clampOffset, parseLimit } from "./parse-query.ts";

describe("parseLimit", () => {
	test("absent limit falls back to the surface default", () => {
		expect(parseLimit(undefined, 100)).toBe(100);
		expect(parseLimit(undefined, 200)).toBe(200);
	});

	test("positive integers pass through, capped at 1000", () => {
		expect(parseLimit("1", 100)).toBe(1);
		expect(parseLimit("250", 100)).toBe(250);
		expect(parseLimit("1001", 100)).toBe(1000);
	});

	test.each([
		"",
		"0",
		"-5",
		"1.5",
		"10abc",
		"1e3",
		" 5",
		"05",
		"9007199254740993",
	])("rejects malformed limit %p instead of coercing it", (value) => {
		expect(() => parseLimit(value, 100)).toThrow(
			new ValidationError("limit must be a positive integer"),
		);
	});
});

describe("clampLimit", () => {
	test("absent, garbage or non-positive limit falls back to the route default", () => {
		for (const value of [undefined, "", "0", "-3", "abc"]) {
			expect(clampLimit(value, 50, 200)).toBe(50);
		}
	});

	test("positive values pass through, capped at the route max", () => {
		expect(clampLimit("1", 50, 200)).toBe(1);
		expect(clampLimit("10abc", 50, 200)).toBe(10);
		expect(clampLimit("500", 50, 200)).toBe(200);
	});
});

describe("clampOffset", () => {
	test("absent, garbage or negative offset is 0", () => {
		for (const value of [undefined, "", "-3", "abc"]) {
			expect(clampOffset(value)).toBe(0);
		}
	});

	test("non-negative values pass through", () => {
		expect(clampOffset("0")).toBe(0);
		expect(clampOffset("40")).toBe(40);
	});
});
